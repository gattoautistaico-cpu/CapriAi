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

## Novità 0.7.0 — Desktop pet

Nuova modalità **Desktop pet** (Impostazioni → Desktop pet, oppure Modalità → Desktop pet). Capri vive sul desktop da sola, come nei progetti [lachydotmcg/capri-desktop](https://github.com/lachydotmcg/capri-desktop) e [notme71/Capri-Desktop](https://github.com/notme71/Capri-Desktop), che qui sono stati riscritti in TypeScript/Rust, uniti e collegati al cervello di Cyber AI (AI locale/cloud, voce, Hey Capri, strumenti).

**Movimento e fisica**
- Si siede sui bordi delle finestre (solo sui tratti non coperti) e segue la finestra quando la sposti.
- Se la finestra viene coperta, ridotta a icona o chiusa, si alza e cade sul bordo successivo o sopra la taskbar.
- Trascinata resta appesa ("dangle"). Al rilascio cade sul bordo sotto di lei. **Shift** al rilascio = si siede lì, **Ctrl** = resta appesa.
- **Lancio con inerzia**: lanciala e vola, rimbalza sui lati dello schermo e atterra sul primo bordo che attraversa.
- **Doppio clic**: sale sul cursore e si inclina mentre lo muovi. Per farla scendere usa **Ctrl+Alt+C**.
- Salta da sola ad arco da una finestra all'altra.
- Sbircia dal bordo dello schermo più vicino quando non tocchi il PC per 90 s.
- Si nasconde quando un'app è a schermo intero.
- Taglie: 170, 240, 320, 440.

**Vita autonoma**
- Animazioni a strisce: respiro, inclinazione, blink e blink glitch inseriti nel ciclo, glitch ogni 30-60 s, bocca che si muove mentre parla.
- Si stiracchia, si guarda intorno e sbadiglia. Dopo N secondi senza input sbadiglia e si addormenta (con le z), e si sveglia quando torni.
- **Carezze**: muovi il mouse avanti e indietro sopra di lei. Fanno comparire i cuori e alzano il sync.
- **Mischief**: ogni tanto "hackera" lo schermo con effetti leggeri e click-through (Ctrl+Alt+C li ferma). Ci sono 6 stili (barre, strappo, corruzione, hex rain, ENGRAM SYNC, cursore inseguitore) e se ne sblocca uno nuovo ogni 10% di sync. Il chip di Capri entra dall'alto a destra.
- **Sync**: sale con il tempo passato insieme, i messaggi, le carezze e le sfide completate, con limiti giornalieri. Cambia il tono delle risposte (da diffidente a possessiva). Chiedi "com'è il nostro sync?".
- **Osservazioni spontanee**:
  - quando rientri dopo 20+ minuti;
  - a notte fonda;
  - con la batteria sotto il 20%;
  - con la CPU al 90% per 30 s;
  - dopo ore nella stessa app.
  - Ogni tipo ha la sua pausa.
- **Sfide** adatte all'app in primo piano (browser, chat, codice, musica, documenti), generate dall'AI con un filtro di sicurezza oppure prese da una lista. "Sfidami" ne chiede una, "fatto" la completa.
- **Musica**: dondola a ritmo e commenta il brano quando Spotify o YouTube suonano.
- **Battute registrate**: file `.wav` o `.mp3` per occasione (`pat.wav`, `wake.wav`, `alarm.wav`…), messi nella cartella aperta da Impostazioni → Desktop pet.

**Interfaccia**
- Fumetto "Neon": angoli tagliati, bordo verde con segni cremisi, ritratto che muove la bocca. Per gli hack c'è la variante terminale verde ("> testo_").
- Card **cut-in** con gli occhi.
- Menu Neon con il tasto destro: parla/scrivi, sfidami, siediti/alzati, cursore, sbircia, dormi, riportala qui, mischief, taglia, sync, impostazioni, esci.
- Passando sopra di lei compaiono la matita (scrivi) e l'onda (parla).
- Scorciatoie: **Ctrl+Alt+T** scrivi, **Ctrl+Alt+V** parla, **Ctrl+Alt+L** guarda lo schermo, **Ctrl+Alt+C** scendi / ferma i dispetti.
- Avvio con Windows, opzionale.
- Personalità **"Capri (costrutto)"**, adattata dalla persona di Capri-Desktop.

**Commissioni senza AI** (in italiano, inglese e polacco, in tutte le modalità):
- timer ("timer di 10 minuti");
- promemoria ("ricordami di X tra 20 minuti", "… alle 18:30");
- sveglie ("sveglia alle 7");
- studio a pomodoro ("studiamo"), cancella sveglie;
- apri Download, Documenti, Desktop, Immagini, Video, Esplora file, Blocco note, Calcolatrice, Paint, Gestione attività, Impostazioni, Strumento di cattura;
- volume su/giù, muto;
- chiudi, riduci o passa a un'app ("chiudi spotify", "chiudi la scheda youtube");
- "metti X su YouTube" apre direttamente il primo video;
- "ricorda che…", "dimentica…", "dimentica tutto" (i segreti come password, carte o token non li salva).

**Sprite**: le animazioni sono fan art di *Cyberpunk: Edgerunners* e **non sono incluse**.
- In Impostazioni → Desktop pet → Sprite puoi scaricarle dai repository originali (commit fissati, in `%APPDATA%`) oppure importarle da una cartella.
- Senza sprite il pet usa le GIF del profilo attivo.

**Migliorie rispetto agli originali**
- Tutto vive dentro l'overlay Tauri, senza finestre extra.
- Lancio con inerzia.
- Quando la finestra sotto di lei sparisce cade sul bordo successivo, invece di restare sospesa.
- La zona cliccabile segue il frame opaco.
- Usa i modelli e le voci di Cyber AI.
- È in tre lingue.
- Le sveglie funzionano anche fuori dalla modalità pet.

## Novità 0.6.0

- **Menu CAPRI** (tasto destro su Capri), con lo stesso stile del video:
  - microfono on/muted;
  - voce ON / BLIPS / OFF;
  - dimentica la conversazione, ricarica la personalità;
  - instant replay, apri cartella dei clip (`Ctrl+Alt+C`), scorciatoie;
  - clingy mode, drag mode;
  - impostazioni, esci.
- **Drag mode LIGHTNING**: trascini un lazo a fulmine rosso dalla finestra al punto voluto e Capri ci "salta" con un glitch.
- **Clingy mode**: Capri si attacca alla finestra in primo piano (lampo rosso) e la segue quando la sposti.
- **Modalità rapide**, eseguite senza AI e quindi con latenza minima:
  - "DJ mode": la frase successiva è un brano da mettere;
  - "search mode": la frase successiva è una ricerca su YouTube (oppure "google …");
  - "cancel" per tornare alla normalità.
  - Etichette `CAPRI // DJ MODE`, `SEARCH MODE` (con barra di ricerca), `REWIRING` nei cambi di modalità.
- **Instant replay di Capri** con ffmpeg:
  - "clip that" salva gli ultimi 30 s in `Video\Capri Clips`;
  - nel terminale compare `// saved Capri clip …mp4`, con l'animazione dell'occhio e `// CLIPPED 30s`;
  - encoder hardware AMD/NVIDIA/Intel se disponibile;
  - ffmpeg si scarica da **Impostazioni → Clip**.
- **Voce "Undertale"**: un blip per lettera al posto della voce, sincronizzato con il testo (Impostazioni → Voce oppure menu → VOICE).
- **Stile più fedele al video**: TALKING rosso, THINKING giallo con angoli, DJ/SEARCH/CLIPPED verdi, terminale con angolo tagliato, righe di sistema `// …`.
- **Correzioni**:
  - apertura delle app e ricerche Google ora passano da `ShellExecute`, così niente più problemi con spazi, `&` o `%`;
  - le app non trovate vengono cercate anche per nome di sistema ("notepad", "steam").
- **Latenza delle trascrizioni**:
  - una frase finisce dopo 550 ms di silenzio (prima erano 900 ms);
  - whisper usa la decodifica greedy, senza ripetizioni a temperature più alte, con un suggerimento con il nome e i comandi;
  - in ascolto passivo le frasi lunghe (chiacchiere) vengono saltate e la coda tiene solo la frase più recente;
  - comandi rapidi senza AI;
  - modello veloce opzionale (`ggml-base-q5_1`, scaricabile da Impostazioni → Ascolto) per Hey Capri e "clip that".

## Novità 0.5.1

- **Capri si vede in Discord, OBS e nelle registrazioni.** Prima la finestra era esclusa da ogni cattura dello schermo.
  - La regola l'opzione **Impostazioni → Modalità → Visibile in Discord / OBS**, attiva di default.
  - Dai suoi screenshot per la visione e l'OCR resta comunque esclusa, solo per l'istante dello scatto.

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

- Codice di Cyber AI / Capri AI: **Apache License 2.0**, vedi [LICENSE](LICENSE) e [NOTICE](NOTICE). © 2026 gattoautistaico-cpu. I nomi "Cyber AI" e "Capri AI" non sono concessi in licenza (Apache-2.0, sezione 6).
- **Modalità desktop pet** (`src/lib/pet/`, `src/components/pet/`, `src-tauri/src/pet.rs`): opera derivata da
  - [lachydotmcg/capri-desktop](https://github.com/lachydotmcg/capri-desktop) — *Required Notice: Copyright 2026 Lachy (https://github.com/lachydotmcg)* — **PolyForm Noncommercial 1.0.0** ([testo](LICENSES/PolyForm-Noncommercial-1.0.0.md));
  - [notme71/Capri-Desktop](https://github.com/notme71/Capri-Desktop) — Copyright (c) 2026 vincent — **MIT** sulle parti aggiunte o riscritte da vincent ([testo](LICENSES/MIT-notme71-Capri-Desktop.txt)).
- Per via della licenza PolyForm Noncommercial, **le build che includono la modalità pet si possono usare, copiare e modificare solo per scopi non commerciali**. Dettagli in [LICENSES/README.md](LICENSES/README.md).
- Capri e *Cyberpunk: Edgerunners* © CD PROJEKT RED / Studio Trigger. Progetto di fan, non ufficiale. Gli sprite non sono inclusi: si scaricano su richiesta dagli autori originali.

### Crediti

- **lachydotmcg** — [capri-desktop](https://github.com/lachydotmcg/capri-desktop), il primo a portare Capri sul desktop.
- **vincent (notme71)** — [Capri-Desktop](https://github.com/notme71/Capri-Desktop): comportamenti, mischief, sync, commissioni.
- **jpartnma_** — il video TikTok che ha ispirato entrambi.
- Font *Share Tech Mono* (SIL OFL 1.1) tramite Google Fonts.

### License (English)

Cyber AI's own code is Apache-2.0. Desktop pet mode is derived from lachydotmcg/capri-desktop (PolyForm Noncommercial 1.0.0, Required Notice: Copyright 2026 Lachy) and notme71/Capri-Desktop (MIT, Copyright (c) 2026 vincent), so builds that include it are for **non-commercial use only**. The Capri artwork (© CD PROJEKT RED / Studio Trigger) is not bundled; the app downloads it from the original repositories only on request.
