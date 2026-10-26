# Cyber AI per Android: progetto

Questa è un'ipotesi di architettura. Il codice React e la logica (`src/lib`) restano condivisi con la versione desktop. Cambiano solo la shell nativa e i servizi locali.

## Cosa cambia rispetto al PC

| Funzione | Windows (oggi) | Android |
|---|---|---|
| Overlay sopra le app | finestra Tauri trasparente, always-on-top | **bolla flottante** con `SYSTEM_ALERT_WINDOW` in un Foreground Service (stile "chat head"). Tocco = espande Capri |
| Interfaccia | WebView2 | WebView Android (Tauri v2 mobile), lo stesso React |
| LLM | Ollama locale su RX 6600 | 1) **il tuo PC in LAN**, cioè Ollama su `http://<ip-pc>:11434` (`OLLAMA_HOST=0.0.0.0`); 2) Gemini multi-key; 3) OpenRouter free; 4) on-device opzionale: Gemma 3 1B/Qwen2.5 1.5B Q4 via llama.cpp (solo telefoni con 8 GB+) |
| STT | whisper-server su CPU | `SpeechRecognizer` di Android (offline se il pacchetto lingua è installato) → fallback whisper del PC in LAN → Gemini audio |
| TTS | Piper | `TextToSpeech` di Android (voci Google offline) → Piper del PC in LAN → ElevenLabs |
| Visione | screenshot periodico | `MediaProjection` con consenso esplicito, scatto solo su richiesta ("guarda") per batteria e privacy |
| Hotkey | Ctrl+Shift+W | tocco lungo sulla bolla, tile nelle impostazioni rapide, opz. assistente predefinito (`VoiceInteractionService`) |
| Musica | swiftFree HTTP / Spotify | swiftFree via **intent** (`docs/SWIFTFREE_API.md §3`) + stato da `MediaSession`; Spotify via App Remote SDK |
| Memoria e profili | `cyberai.json` | stesso store (plugin-store), più sincronizzazione opzionale col PC |

## Architettura

```
┌──────────── App Tauri v2 (Android) ────────────┐
│ React UI condivisa (Capri / Classica)          │
│ src/lib: router AI, brain, personalità, memoria │
│  └ adapter "platform": desktop | android        │
└──────────────┬──────────────────────────────────┘
               │ plugin Tauri Kotlin (cyberai-android)
┌──────────────▼──────────────────────────────────┐
│ BubbleService (Foreground, TYPE_APPLICATION_OVERLAY)│
│   WebView mini: sigillo + terminale Capri          │
│ SpeechBridge  SpeechRecognizer / TextToSpeech      │
│ ScreenBridge  MediaProjection (on demand)          │
│ MusicBridge   intent swiftFree + MediaController   │
│ LanDiscovery  mDNS "_cyberai._tcp" → trova il PC   │
└────────────────────────────────────────────────────┘
```

**Modalità "satellite"**, consigliata. Il telefono non fa girare modelli pesanti. Usa il PC come cervello in LAN: Ollama, whisper e Piper. Quando sei fuori casa passa da solo a Gemini e OpenRouter. Nell'HUD lo stato si legge così: `LOCAL (PC)` → `GEMINI` → `OPENROUTER`.

## Permessi

- `SYSTEM_ALERT_WINDOW` per la bolla: si chiede la prima volta, con una schermata che spiega a cosa serve.
- `RECORD_AUDIO` e `FOREGROUND_SERVICE_MICROPHONE`.
- `FOREGROUND_SERVICE_MEDIA_PROJECTION`, solo se usi la visione.
- `POST_NOTIFICATIONS` per la notifica del servizio, obbligatoria.
- `INTERNET` e `ACCESS_NETWORK_STATE`.
- `QUERY_ALL_PACKAGES` non serve: per swiftFree basta `<queries><package android:name="com.swiftfree"/></queries>`.

## Passi di sviluppo

1. `npm run tauri android init`, poi aggiungere il plugin Kotlin `cyberai-android`.
2. Creare l'adapter `platform.ts`. Raccoglie le chiamate oggi dirette a `invoke(...)`: `capture_screen`, `piper_tts`, `start_service`, `media_key`, `open_url`. Su Android le reindirizza ai bridge Kotlin.
3. Creare un `BubbleService` con WebView ridotta: carica la stessa build su una route `/bubble`, che mostra solo sigillo e terminale.
4. Collegare STT e TTS nativi, con `stt.mode = 'android'` e `tts.engine = 'android'`.
5. Implementare il `MusicBridge` verso swiftFree con intent espliciti.
6. Aggiungere la scoperta del PC in LAN via mDNS, più l'abbinamento con un codice a 6 cifre e un token salvato.
7. Build con GitHub Actions: runner `ubuntu-latest`, JDK 17, Android SDK e NDK, `tauri android build --apk`. Lo stesso approccio che usi già per swiftFree.

## Limiti da sapere

- Android 14 e successivi chiudono i servizi in background senza notifica. La bolla mostra sempre una notifica persistente "Capri online".
- MIUI, ColorOS e altre ROM possono bloccare l'overlay. Va disattivata l'ottimizzazione batteria per Cyber AI.
- Il microfono in ascolto continuo consuma molta batteria. Su Android il default è il tocco per parlare.
