# CYBER AI

AI companion anime che vive sul desktop, in trasparenza sopra le finestre.
Stile cyberpunk, locale prima di tutto.
Pensata per **RX 6600 8 GB · i5 9a gen · 32 GB RAM**.

## Architettura

```
┌──────────────────────── Finestra Tauri (trasparente, always-on-top, esclusa dagli screenshot) ────────────────────────┐
│ React + Tailwind + Framer Motion                                                                                      │
│  Avatar (sprite)  Balloon  Dock  HUD  Chat  Impostazioni           ← zone cliccabili registrate (hit.ts)             │
│        │                                                                                                              │
│  brain.ts  ── conversazione, mood [mood:x], memoria <ricorda>, reazioni allo schermo                                 │
│   ├─ router.ts  LOCALE (Ollama/LM Studio) → GEMINI multi-key (rotazione+cooldown) → OPENROUTER :free                │
│   ├─ stt.ts     mic → VAD/push-to-talk → WAV 16k → whisper-server (CPU) → fallback Gemini audio                      │
│   └─ tts.ts     Piper (CPU) → voci Windows (offline) → ElevenLabs; livello audio → lip sync                          │
└───────────────┬──────────────────────────────────────────────────────────────────────────────────────────────────────┘
                │ invoke
┌───────────────▼─────────── Rust (src-tauri/src/lib.rs) ───────────────────────────────┐
│ click-through selettivo (cursore vs zone)  ·  cattura schermo (xcap → JPEG)          │
│ piper_tts  ·  start/stop whisper-server  ·  import sprite in AppData  ·  tray        │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Budget VRAM (limite 6,5 GB)

| Componente | Dove | VRAM |
|---|---|---|
| LLM chat `qwen2.5:7b` Q4_K_M, contesto 4096, KV q8 | GPU Vulkan | ~4,9 GB |
| Visione `moondream` (a turno, `OLLAMA_MAX_LOADED_MODELS=1`) | GPU | ~1,7 GB |
| *oppure* `gemma3:4b` chat + visione in un modello | GPU | ~3,5 GB |
| Whisper small | CPU (6 thread) | 0 |
| Piper | CPU | 0 |

L'HUD mostra la VRAM reale letta da Ollama (`/api/ps`). Diventa rossa sopra il limite.

## Installazione rapida (utente)

1. Esegui `install.bat` (installazione guidata). Installa:
   - Ollama con i limiti VRAM
   - i modelli
   - whisper.cpp
   - Piper con le voci `it_IT-paola` ed `en_US-amy`

   Tutto va in `%LOCALAPPDATA%\CyberAI\tools`.
2. Installa `Cyber AI_x.y.z_x64-setup.exe` (oppure usa `CyberAI-portable.exe`).
3. Al primo avvio si aprono le Impostazioni:
   - i percorsi di whisper e Piper vengono rilevati da soli
   - importa gli sprite nella scheda **Avatar**
   - inserisci le API key nella scheda **API cloud**

### Modelli locali per RX 6600

Su Windows ROCm non supporta la RX 6600: si usa **Vulkan**. Ollama lo include già, basta un driver Adrenalin aggiornato.

```powershell
ollama pull gemma3:4b      # leggero: chat + visione
ollama pull qwen2.5:7b     # chat di qualità (italiano buono)
ollama pull moondream      # visione piccola
```

Alternativa con LM Studio:
- Settings → Runtime → **Vulkan llama.cpp**
- scarica un modello 7B in Q4_K_M e un VLM 4B
- avvia il server, porta 1234
- nell'app premi il pulsante "LM Studio"

Variabili impostate dallo script, consigliate:
- `OLLAMA_CONTEXT_LENGTH=4096`
- `OLLAMA_KV_CACHE_TYPE=q8_0`
- `OLLAMA_FLASH_ATTENTION=1`
- `OLLAMA_MAX_LOADED_MODELS=1`

## Sprite

- Ogni profilo ha più **outfit**.
- Ogni outfit ha degli **stati**, e ogni stato ha **N frame**:

| Stato | Uso |
|---|---|
| `idle` | riposo, in loop a FPS impostabili |
| `blink` | occhi chiusi, inserito a caso ogni 3-6 s |
| `talk` | bocca da chiusa ad aperta; il frame è scelto in base al volume della voce (lip sync). Con 1 solo frame alterna idle/talk |
| `listen`, `think` | mentre ascolta o elabora |
| `happy` `angry` `sad` `surprised` `love` `smug` `sleep` | mood scelto dall'AI con `[mood:x]` |
| personalizzati | es. `gaming`, `dance` |

Formati supportati: PNG, WebP, GIF animate, APNG.
Usa lo sfondo trasparente e la stessa dimensione per tutti i frame.

Comandi sull'avatar:
- trascina per spostarlo
- rotella per scalarlo
- doppio click apre la chat
- tasto destro apre le impostazioni

## API cloud

- **Gemini**: incolla una o più key (separate da a capo).
  - Rotazione round-robin.
  - Su errore 429 la key va in cooldown (il tempo segue `retryDelay` o il valore impostato).
  - Su errore 401/403 la key viene segnata come non valida.
  - Se un modello dà 404 si passa al successivo nella lista.
- **OpenRouter**: legge la lista modelli e tiene solo quelli `:free` o a prezzo 0.
  - Per la visione usa solo modelli con input immagine.
- La scheda **Log** mostra ogni tentativo: provider, modello e key usati.
  - L'HUD mostra il provider attivo in quel momento.
- L'ordine dei provider si cambia nella scheda **AI locale**.


## Funzioni allineate con la versione Android

| Funzione | Come chiederla | Desktop |
|---|---|---|
| Apri app | "apri Discord" | menu Start (`Get-StartApps`), corrispondenza approssimata sul nome |
| YouTube / Google | "cerca lo-fi su YouTube", "cercami … su Google" | si apre nel browser predefinito |
| Ricerca web con risposta | "chi ha vinto ieri?" | DuckDuckGo, Wikipedia come ripiego, poi Capri risponde |
| Leggi lo schermo | "cosa c'è scritto qui?", "spiegami questo errore" | titolo della finestra + OCR di Windows (`Windows.Media.Ocr`) + screenshot per la visione |
| Chiamate | "chiama Marco" | link `tel:` → Collegamento al telefono, con 4 s per annullare |
| WhatsApp | "chiama/scrivi a Marco su WhatsApp" | WhatsApp Desktop (`whatsapp://send`), con wa.me come ripiego |
| Hey Capri | "Hey Capri, apri Spotify" | ascolto continuo con whisper locale; risponde solo alla parola di attivazione |
| Invio immagine | pulsante IMG nel terminale | visione |
| Altri provider free | scheda **API free** | Groq, Cerebras, Mistral, GitHub Models, NVIDIA NIM, Hugging Face, Cloudflare |

Router con fallback completo:
- ordine: locale → Gemini multi-key → provider free → OpenRouter `:free`;
- 30 s per chiamata, 60 s in tutto;
- pause per key e modelli che vanno in errore;
- se l'immagine non è accettata da nessun modello, riprova senza;
- se falliscono tutti, Capri risponde con una frase offline.

I contatti per chiamate e WhatsApp si aggiungono in **Impostazioni → Strumenti**. Su PC non c'è una rubrica da cui leggerli.

## Compilare (Windows)

**Prima volta (circa 20 minuti)**
1. Estrai lo zip, ad esempio in `E:\CyberAI\cyber-ai`.
2. Fai doppio clic su `install.bat` e rispondi **s** alla sezione 4, "Strumenti di sviluppo". Installa:
   - Git, Node.js LTS, Rust (toolchain MSVC);
   - Visual Studio Build Tools con "Sviluppo desktop C++";
   - WebView2.
3. Chiudi e riapri il terminale, così il PATH si aggiorna.

**Ogni build**
1. Fai doppio clic su `build.bat`. L'output va in `build.log`.
   - La prima volta servono 5-15 minuti, poi circa 1-3.
2. Risultato in `release\`:
   - `Cyber AI_x.y.z_x64-setup.exe` è l'installer;
   - `CyberAI-portable.exe` è l'eseguibile singolo.

**Da terminale (PowerShell nella cartella del progetto)**
```powershell
npm install
npm run tauri build        # installer in src-tauri\target\release\bundle\nsis
npm run app:dev            # sviluppo con ricarica automatica
```

**Errori comuni**
| Messaggio | Soluzione |
|---|---|
| `MANCA: cargo` / `node` | `install.bat` → sezione 4, poi riapri il terminale |
| `link.exe not found` | manca "Sviluppo desktop C++" nei VS Build Tools |
| `failed to bundle project` (NSIS) | rilancia: il primo download di NSIS a volte va in timeout |
| errore su `xcap` | `cargo update -p xcap` dentro `src-tauri`, poi rilancia |
| OCR vuoto | Impostazioni Windows → Lingua: aggiungi italiano/inglese con "Riconoscimento ottico caratteri" |

**Android**: l'APK si compila separatamente; i sorgenti sono in `CapriAI-android-src.zip`.

## Sviluppo e build

```powershell
scripts\setup.ps1          # sezione 4: Node, Rust, VS Build Tools, WebView2
npm install
npm run app:dev            # sviluppo
scripts\build-windows.ps1  # installer NSIS + exe portable in .\release
```

Build automatica: fai push su GitHub e il workflow `.github/workflows/build-windows.yml` compila su `windows-latest`. Gli `.exe` si scaricano dagli artifact; per i tag `v*` finiscono anche nella release.

## Note

- Le API key restano in chiaro in `%APPDATA%\com.cyberai.desktop\cyberai.json`.
- I font Orbitron, Rajdhani e Share Tech Mono arrivano da Google Fonts. Offline si usano Bahnschrift e Consolas.
- Hotkey push-to-talk predefinita: `Ctrl+Shift+W`, modificabile nella scheda Ascolto.
- Dal tray, "Blocca/Sblocca interazione" rende tutta la finestra cliccabile. Serve se il click-through dà problemi.

## Novità 0.5.0

- **Riquadro in alto a destra rimosso**: la barra di stato non c'è più.
- **GIF predefinite** *Happy* e *Talking*. Si usano finché non importi sprite per quegli stati.
- **Clip con la voce** ("Capri clip that", "Capri clippa", frasi personalizzabili). Capri preme il tasto "salva clip" del programma attivo:

  | Programma | Tasto predefinito | Cosa attivare nel programma |
  |---|---|---|
  | Medal | `F8` | clip in background |
  | AMD Adrenalin | `Ctrl+Shift+S` | Instant Replay |
  | NVIDIA (ShadowPlay / NVIDIA App) | `Alt+F10` | Instant Replay |
  | Xbox Game Bar (ripiego) | `Win+Alt+G` | — |

  - In modalità automatica il programma viene riconosciuto dai processi attivi.
  - L'opzione "Ascolta i comandi di clip" tiene il microfono aperto solo per queste frasi (whisper locale).
  - Anche l'AI può fare un clip, con il tag `<clip/>`.
  - Si configura in **Impostazioni → Clip**.
- **Lovense**: si collega tramite la Lovense Remote in *Game Mode*, la stessa API locale usata dai plugin "for Remote" per game engine. Si configura in **Impostazioni → Lovense**.
  - Ricerca dei giocattoli, scelta del giocattolo, limite d'intensità, pulsante STOP.
  - Preset Lovense (pulse, wave, fireworks, earthquake).
  - Editor di pattern: barre trascinabili 0-20, fino a 50 passi, funzioni (vibrate, rotate, pump, thrust…), intervallo, durata.
  - Collegamento mood → pattern.
  - Controllo da parte dell'AI con i tag `<toy pattern="Onda" sec="20"/>`, `<toy v="12" sec="5"/>` e `<toy stop/>`.
- **Polacco**:
  - interfaccia, risposte e riconoscimento vocale (`pl`);
  - voce Piper `pl_PL-gosia`, scaricabile da **Impostazioni → Voce**, con la voce Windows polacca come ripiego.

## Lingua / Language / Język

L'interfaccia è in italiano, inglese e polacco. Al primo avvio la lingua segue quella di Windows. Per cambiarla vai in **Impostazioni → Modalità → Lingua · Language · Język**:
- cambiano anche la lingua delle risposte dell'AI e quella del riconoscimento vocale (whisper);
- l'app si ricarica.

Per una voce inglese con Piper scegli `en_US-amy` nella scheda **Voce**.

The UI is available in Italian and English. Switch it in **Settings → Mode → Lingua · Language**. AI replies and speech recognition follow the selected language.

## Licenza

Apache License 2.0: vedi [LICENSE](LICENSE) e [NOTICE](NOTICE). © 2026 gattoautistaico-cpu.
I nomi "Cyber AI" e "Capri AI" non sono concessi in licenza (Apache-2.0, sezione 6).
