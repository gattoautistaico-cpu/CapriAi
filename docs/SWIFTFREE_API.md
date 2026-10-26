# swiftFree ↔ Cyber AI: protocollo di controllo

Cyber AI controlla swiftFree, la versione di Swiftify con sorgenti gratuite, in due modi:

1. **Server HTTP locale.** È il metodo preferito, per desktop e Android.
2. **Deep link `swiftfree://`.** È il fallback, usato quando il server non risponde o swiftFree è chiuso.

Il lato Cyber AI è già pronto in `src/lib/swiftfree.ts`. Il lato swiftFree va aggiunto nel repo `swiftFree`.

## 1. Server HTTP

- Ascolta solo su `127.0.0.1:47800`, mai su `0.0.0.0`.
- Si attiva con il flag `--control-server` oppure da un'opzione nelle impostazioni.
- Il token è opzionale. Se configurato, ogni richiesta deve avere l'header `Authorization: Bearer <token>`, altrimenti risponde `401`.
- Usa JSON UTF-8.

| Metodo | Path | Body | Risposta |
|---|---|---|---|
| GET | `/api/v1/status` | — | `{ "app":"swiftFree", "version":"0.19.0", "playing":true, "track":{ "title","artist","source":"youtube" } \| null }` |
| POST | `/api/v1/play` | `{ "query":"titolo artista" }` | `200 { "track":{ "id","title","artist","source" } }`, oppure `404` se non trova nulla |
| POST | `/api/v1/control` | `{ "action":"pause\|resume\|next\|prev" }` | `200 {}` |
| POST | `/api/v1/queue` *(opz.)* | `{ "query" }` | `200 { "track" }` |
| GET | `/api/v1/lyrics` *(opz.)* | — | `{ "lines":[{ "t":12.3, "text":"…" }] }` per il karaoke del terminale |

Cosa fa `play`:
- cerca con la stessa pipeline che usa la barra di ricerca (YouTube o le altre sorgenti libere);
- prende il primo risultato e lo mette in riproduzione subito;
- risponde **dopo** che il brano è stato risolto, così Cyber AI può mostrare `// now playing: titolo - artista`.

## 2. Deep link

Registra lo schema `swiftfree` in questi punti:
- Windows: chiave di registro `HKCU\Software\Classes\swiftfree`, che punta a `"swiftify.exe" "%1"`;
- Android: `intent-filter` con `scheme="swiftfree"`.

| URI | Azione |
|---|---|
| `swiftfree://play?q=<query url-encoded>` | cerca e riproduce |
| `swiftfree://control/pause` · `resume` · `next` · `prev` | comandi |

Se swiftFree è già aperto, l'URI va inoltrato all'istanza esistente:
- Windows: single-instance;
- Android: `launchMode="singleTask"` + `onNewIntent`.

## 3. Android: intent espliciti

Su Android la Cyber AI companion app usa intent espliciti invece di HTTP, che consuma più batteria. È più affidabile in background.

```
action:  com.swiftfree.action.PLAY     extra "query": String
action:  com.swiftfree.action.CONTROL  extra "action": "pause|resume|next|prev"
receiver esportato con permesso: com.swiftfree.permission.CONTROL (protectionLevel="signature" se firmati con la stessa chiave, altrimenti "normal" + conferma utente al primo uso)
```

swiftFree pubblica lo stato con la `MediaSession` standard. Cyber AI Android lo legge con `MediaController`, per cui non servono API extra per sapere cosa è in riproduzione.

## Sicurezza

- Il server HTTP accetta solo connessioni da loopback.
- Ignora l'header `Origin` dei browser e rifiuta le richieste con `Origin` diverso da `tauri://localhost` o assente, così una pagina web non può pilotare il lettore.
- Il token si genera una volta e si mostra nelle impostazioni di swiftFree, per copiarlo in Cyber AI.
