/**
 * Commissioni rapide senza AI (italiano / inglese / polacco):
 * timer, sveglie, promemoria, studio (pomodoro), cancella sveglie; apri cartelle e strumenti di Windows;
 * volume e muto; chiudi / riduci / passa a un'app o a una scheda; metti il primo video di YouTube;
 * ricorda / dimentica (rifiuta i segreti); "sfidami" / "fatto"; "com'è il nostro sync?".
 * Parser adattato da Errands di notme71/Capri-Desktop (MIT) e dagli strumenti app_window/media di
 * lachydotmcg/capri-desktop (PolyForm Noncommercial 1.0.0).
 */
import { invoke } from '@tauri-apps/api/core';
import { norm, score } from '../actions';
import { useApp } from '../store';
import { usePet } from './bus';
import { getWindows } from './desk';
import { addAlarm, clearAlarms, dareDone, giveDare, startStudy, syncReply } from './life';
import { L } from './lines';

export interface Errand {
  /** risposta di Capri */
  say: string;
  mood?: string;
  sys?: string;
}

const NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, sixty: 60,
  un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, quindici: 15, venti: 20, trenta: 30, quaranta: 40, sessanta: 60,
  jeden: 1, jedna: 1, jedną: 1, dwa: 2, dwie: 2, trzy: 3, cztery: 4, piec: 5, pięć: 5, dziesiec: 10, dziesięć: 10, pietnascie: 15, dwadziescia: 20, trzydziesci: 30,
};

const UNIT = String.raw`(seconds?|secs?|minutes?|mins?|hours?|hrs?|secondi|secondo|minuti|minuto|ore|ora|sekund[ay]?|minut[ay]?|godzin[ay]?|godzine)`;
const AMOUNT = String.raw`(\d+(?:[.,]\d+)?|${Object.keys(NUM).join('|')})`;

/** Secondi in una frase tipo "10 minuti", "an hour", "mezz'ora", "pół godziny"; 0 se non c'è. */
export function duration(t: string): number {
  if (/\b(half an? hour|mezz ?ora|mezzora|pol godziny|pół godziny)\b/.test(t)) return 1800;
  if (/\b(un quarto d ?ora|a quarter of an hour|kwadrans)\b/.test(t)) return 900;
  const m = new RegExp(`\\b${AMOUNT}\\s*${UNIT}\\b`).exec(t);
  if (!m) return 0;
  const n = NUM[m[1]] ?? parseFloat(m[1].replace(',', '.'));
  const u = m[2];
  const sec = /^(h|ore|ora|godzin)/.test(u) ? n * 3600 : /^(m)/.test(u) ? n * 60 : n;
  return sec >= 1 && sec <= 86400 ? sec : 0;
}

export function describe(sec: number): string {
  if (sec < 60) return L(`${Math.round(sec)} secondi`, `${Math.round(sec)} seconds`, `${Math.round(sec)} s`);
  if (sec < 3600) {
    const m = Math.round(sec / 60);
    return L(m === 1 ? '1 minuto' : `${m} minuti`, m === 1 ? '1 minute' : `${m} minutes`, `${m} min`);
  }
  const h = Math.floor(sec / 3600);
  const r = Math.round((sec - h * 3600) / 60);
  return L(`${h} ${h === 1 ? 'ora' : 'ore'}`, `${h} ${h === 1 ? 'hour' : 'hours'}`, `${h} godz.`) + (r ? ` ${r} min` : '');
}

/** Prossima volta che l'orologio segna hh:mm (oggi o domani); senza am/pm sceglie la più vicina. */
export function nextClock(hour: number, minute: number, half: string, now = new Date()): Date | null {
  if (hour > 23 || minute > 59) return null;
  const hours: number[] = [];
  if (half.startsWith('a')) hours.push(hour % 12);
  else if (half.startsWith('p')) hours.push((hour % 12) + 12);
  else if (hour >= 13 || hour === 0) hours.push(hour);
  else hours.push(hour % 12, (hour % 12) + 12);
  let best: Date | null = null;
  for (const h of hours) {
    const w = new Date(now);
    w.setHours(h, minute, 0, 0);
    if (w.getTime() <= now.getTime() + 5000) w.setDate(w.getDate() + 1);
    if (!best || w < best) best = w;
  }
  return best;
}

const SECRET = /\b(password|passcode|passphrase|pin|credit card|card number|carta di credito|numero (della )?carta|cvv|ssn|social security|codice fiscale|iban|api key|secret key|private key|chiave (privata|api|segreta)|token|seed phrase|haslo|hasło|karta kredytowa|pesel)\b/i;

/** Cartelle e strumenti di Windows apribili per nome. */
function place(n: string): { target: string; label: string } | null {
  const P: [RegExp, string, string][] = [
    [/^(downloads?|download folder|cartella (dei )?download|scaricati|pobrane|folder pobrane)$/, 'shell:Downloads', 'Downloads'],
    [/^(documents?|documenti|cartella documenti|dokumenty)$/, 'shell:Personal', L('Documenti', 'Documents', 'Dokumenty')],
    [/^(desktop|scrivania|pulpit)$/, 'shell:Desktop', 'Desktop'],
    [/^(pictures|photos|immagini|foto|obrazy|zdjecia)$/, 'shell:My Pictures', L('Immagini', 'Pictures', 'Obrazy')],
    [/^(videos?|video|wideo|filmy)$/, 'shell:My Video', 'Video'],
    [/^(music folder|cartella musica|muzyka)$/, 'shell:My Music', L('Musica', 'Music', 'Muzyka')],
    [/^(file explorer|explorer|esplora (file|risorse)|files|this pc|questo pc|eksplorator( plikow)?|ten komputer)$/, 'raw:explorer.exe', 'Explorer'],
    [/^(notepad|blocco note|notatnik)$/, 'raw:notepad.exe', 'Notepad'],
    [/^(calculator|calc|calcolatrice|kalkulator)$/, 'raw:calc.exe', L('Calcolatrice', 'Calculator', 'Kalkulator')],
    [/^(paint)$/, 'raw:mspaint.exe', 'Paint'],
    [/^(task manager|gestione attivita|menedzer zadan)$/, 'raw:taskmgr.exe', 'Task Manager'],
    [/^(settings|windows settings|impostazioni( di windows)?|ustawienia)$/, 'url:ms-settings:', L('Impostazioni', 'Settings', 'Ustawienia')],
    [/^(snipping tool|strumento di cattura|narzedzie wycinanie)$/, 'raw:snippingtool.exe', 'Snipping Tool'],
    [/^(github)$/, 'url:https://github.com', 'GitHub'],
    [/^(reddit)$/, 'url:https://www.reddit.com', 'Reddit'],
    [/^(twitch)$/, 'url:https://www.twitch.tv', 'Twitch'],
  ];
  for (const [re, target, label] of P) if (re.test(n)) return { target, label };
  return null;
}

async function openTarget(target: string) {
  if (target.startsWith('url:')) await invoke('open_url', { url: target.slice(4) });
  else await invoke('open_app', { appId: target });
}

/** Finestra aperta che corrisponde meglio a un nome (programma o titolo). */
async function findWindow(name: string) {
  const wins = await getWindows();
  let best: (typeof wins)[number] | null = null;
  let bs = 0;
  for (const w of wins) {
    if (!w.title) continue;
    const s = Math.max(score(w.exe.replace(/\.exe$/i, ''), name), score(w.title, name) - 5);
    if (s > bs) {
      bs = s;
      best = w;
    }
  }
  return bs >= 40 ? best : null;
}

const BROWSERS = ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe', 'arc.exe'];

const RX = {
  timer: /^(?:set|start|make|create|add|put|give me|metti|imposta|avvia|fai partire|crea|ustaw|wlacz|nastaw)?\s*(?:a |un |una )?(?:timer|countdown|conto alla rovescia|minutnik|odliczanie)\b/,
  timerFor: /^(?:timer|countdown)\s+(?:for|di|da|na)?\s*/,
  remindIn: /^(?:remind me|ricordami(?: di)?|avvisami|przypomnij mi)\b(.*?)\b(?:in|tra|fra|za)\s+(.+)$/,
  remindAt: /^(?:remind me|ricordami(?: di)?|avvisami|przypomnij mi)\b(.*?)\b(?:at|alle|all|o|o godzinie)\s+(\d{1,2})(?:[:. ](\d{2}))?\s*(am|pm)?$/,
  alarm: /^(?:set |metti |imposta |ustaw )?(?:an |una |la )?(?:alarm|sveglia|budzik)\b.*?(?:for|at|alle|all|per le|na|o)?\s*(\d{1,2})(?:[:. ](\d{2}))?\s*(am|pm)?\s*$/,
  wakeAt: /^(?:wake me(?: up)?|svegliami|obudz mnie)\s+(?:at|alle|all|o)?\s*(\d{1,2})(?:[:. ](\d{2}))?\s*(am|pm)?$/,
  clear: /^(?:clear|cancel|delete|remove|stop|cancella|annulla|elimina|togli|ferma|usun|anuluj|wylacz)\s+(?:(?:all|my|the|tutti|tutte|le|i|wszystkie|moje)\s+)*(alarms?|timers?|reminders?|sveglie|sveglia|timer|promemoria|budziki|minutniki|przypomnienia)$/,
  study: /^(?:study|study mode|let s study|start studying|studio|studiamo|modalita studio|pomodoro|nauka|uczmy sie|tryb nauki)(?:\s+(\d+))?$/,
  stopStudy: /^(?:stop studying|end study|basta studio|fine studio|stop studio|koniec nauki)$/,
  open: /^(?:open|show me|go to|apri|mostrami|vai su|vai a|otworz|pokaz)\s+(?:the |my |la |il |le |i |lo |gli |moj |moje )?(.+)$/,
  volUp: /^(?:volume up|turn it up|louder|alza(?: il)? volume|alza|piu forte|glosniej|podglosnij)(?:\s+(?:by\s+)?(\d+))?$/,
  volDown: /^(?:volume down|turn it down|quieter|softer|abbassa(?: il)? volume|abbassa|piu piano|ciszej|scisz|przycisz)(?:\s+(?:by\s+)?(\d+))?$/,
  mute: /^(?:mute|unmute|muto|silenzio|togli (?:il )?audio|metti (?:in )?muto|wycisz|wylacz dzwiek)$/,
  win: /^(close|quit|exit|kill|minimi[sz]e|minimizza|riduci(?: a icona)?|chiudi|esci da|switch to|go to|vai su|passa a|zamknij|zminimalizuj|przelacz na)\s+(?:the |la |il |lo |l )?(.+?)(?:\s+(?:tab|scheda|karte))?$/,
  ytFirst: /^(?:play|metti|riproduci|fai partire|pusc|zagraj|odtworz)\s+(.+?)\s+(?:on|su|na)\s+youtube$/,
  remember: /^(?:remember(?: that)?|ricorda(?:ti)?(?: che)?|tieni a mente(?: che)?|zapamietaj(?: ze)?)\s+(.{3,})$/,
  forgetAll: /^(?:forget (?:everything|all)|dimentica tutto|zapomnij wszystko)$/,
  forget: /^(?:forget(?: that)?|dimentica(?: che)?|scordati(?: che)?|zapomnij(?: ze| o)?)\s+(.{3,})$/,
  dare: /^(?:dare me|give me a dare|sfidami|fammi una sfida|lanciami una sfida|rzuc mi wyzwanie|wyzwanie)$/,
  done: /^(?:done|did it|i did it|fatto|l ho fatto|fatto!|zrobione|zrobilem|zrobilam|gotowe)$/,
  sit: /^(?:sit|sit down|siediti|siedi|usiadz)$/,
  sleep: /^(?:go to sleep|sleep|dormi|vai a dormire|nanna|idz spac|spij)$/,
  peek: /^(?:peek|peekaboo|cucu|sbircia|a kuku)$/,
  ride: /^(?:ride( my)? cursor|sali sul cursore|wskakuj na kursor)$/,
  hop: /^(?:hop off|get off|scendi|zejdz|zsiadz)$/,
};

/** Prova a gestire la frase come commissione. null = non è una commissione. */
export async function runErrand(raw: string): Promise<Errand | null> {
  const st = useApp.getState();
  const n = norm(raw.replace(/ł/g, 'l').replace(/Ł/g, 'L')).replace(/^(?:can you|could you|would you|please|per favore|puoi|potresti|mozesz|prosze)\s+/, '').replace(/\s+(?:please|per favore|grazie|thanks|prosze)$/, '');
  if (!n) return null;
  const pet = st.settings.ui.mode === 'pet';

  // ---- sync / sfide (in modalità pet)
  const sync = syncReply(raw.trim().replace(/[?!.]+$/, ''));
  if (sync) return { say: sync, mood: 'smug' };
  if (pet && RX.dare.test(n)) {
    void giveDare(true);
    return { say: '' };
  }
  if (pet && RX.done.test(n) && dareDone()) return { say: '' };

  // ---- azioni del pet a voce
  if (pet) {
    const bus = usePet.getState();
    if (RX.sit.test(n)) return bus.act('sit'), { say: '' };
    if (RX.sleep.test(n)) return bus.act('sleep'), { say: L('Mmh... nanna.', 'Mmh... nap time.', 'Mmm... drzemka.'), mood: 'idle' };
    if (RX.peek.test(n)) return bus.act('peek'), { say: '' };
    if (RX.ride.test(n)) return bus.act('ride'), { say: '' };
    if (RX.hop.test(n)) return bus.act('hopoff'), { say: '' };
  }

  // ---- timer / promemoria / sveglie / studio
  if (RX.clear.test(n)) {
    const k = /timer|minutnik/.test(n) ? 'timer' : /remind|promemoria|przypomn/.test(n) ? 'reminder' : /alarm|sveglia|budzik/.test(n) ? 'alarm' : undefined;
    const c = clearAlarms(k);
    return { say: c ? L(`Cancellate (${c}).`, `Cleared (${c}).`, `Usunięte (${c}).`) : L('Non c’era niente da cancellare.', 'Nothing to clear.', 'Nie było nic do usunięcia.'), mood: 'idle' };
  }
  if (RX.stopStudy.test(n)) {
    clearAlarms('study');
    return { say: L('Ok, niente più studio. Finalmente.', 'Fine, no more studying. Finally.', 'Dobra, koniec nauki. Nareszcie.'), mood: 'smug' };
  }
  const sm = RX.study.exec(n);
  if (sm) {
    const rounds = Math.max(1, Math.min(8, parseInt(sm[1] ?? '4', 10) || 4));
    startStudy(rounds);
    return { say: L(`Modalità studio: ${rounds} giri da 25 minuti. Ti tengo d’occhio.`, `Study mode: ${rounds} rounds of 25 minutes. I'm watching you.`, `Tryb nauki: ${rounds} rundy po 25 minut. Pilnuję cię.`), mood: 'smug', sys: 'study' };
  }
  const ri = RX.remindIn.exec(n);
  if (ri) {
    const sec = duration(ri[2]);
    if (sec) {
      const label = ri[1].replace(/^\s*(?:to|di|ze|zeby)\s+/, '').trim();
      addAlarm({ at: Date.now() + sec * 1000, kind: 'reminder', label });
      return { say: L(`Ok, te lo ricordo tra ${describe(sec)}.`, `Okay, I'll remind you in ${describe(sec)}.`, `Dobra, przypomnę ci za ${describe(sec)}.`), mood: 'happy', sys: `reminder +${Math.round(sec)}s` };
    }
  }
  const ra = RX.remindAt.exec(n);
  if (ra) {
    const at = nextClock(parseInt(ra[2], 10), parseInt(ra[3] ?? '0', 10), ra[4] ?? '');
    if (at) {
      addAlarm({ at: at.getTime(), kind: 'reminder', label: ra[1].replace(/^\s*(?:to|di|ze|zeby)\s+/, '').trim() });
      return { say: L(`Promemoria alle ${hm(at)}.`, `Reminder at ${hm(at)}.`, `Przypomnienie o ${hm(at)}.`), mood: 'happy' };
    }
  }
  const al = RX.alarm.exec(n) || RX.wakeAt.exec(n);
  if (al && !duration(n)) {
    const at = nextClock(parseInt(al[1], 10), parseInt(al[2] ?? '0', 10), al[3] ?? '');
    if (at) {
      addAlarm({ at: at.getTime(), kind: 'alarm', label: '' });
      return { say: L(`Sveglia alle ${hm(at)}. Non farmi aspettare.`, `Alarm set for ${hm(at)}. Don't keep me waiting.`, `Budzik na ${hm(at)}. Nie każ mi czekać.`), mood: 'smug', sys: `alarm ${hm(at)}` };
    }
  }
  if (RX.timer.test(n) || (RX.timerFor.test(n) && duration(n))) {
    const sec = duration(n);
    if (sec) {
      const label = (/\b(?:for|per|na)\s+(?:the |il |la )?([a-z ]{3,30})$/.exec(n.replace(new RegExp(`\\b${AMOUNT}\\s*${UNIT}\\b`), ''))?.[1] ?? '').trim();
      addAlarm({ at: Date.now() + sec * 1000, kind: 'timer', label });
      return { say: L(`Timer di ${describe(sec)}. Via!`, `${describe(sec)} timer. Go!`, `Minutnik na ${describe(sec)}. Start!`), mood: 'happy', sys: `timer ${Math.round(sec)}s` };
    }
  }

  // ---- volume
  const vu = RX.volUp.exec(n);
  const vd = RX.volDown.exec(n);
  if (vu || vd) {
    const steps = Math.max(1, Math.min(25, parseInt((vu ?? vd)![1] ?? '5', 10) || 5));
    for (let i = 0; i < steps; i++) await invoke('media_key', { key: vu ? 'vol_up' : 'vol_down' });
    return { say: vu ? L('Più forte!', 'Louder!', 'Głośniej!') : L('Più piano.', 'Quieter.', 'Ciszej.'), mood: 'happy' };
  }
  if (RX.mute.test(n)) {
    await invoke('media_key', { key: 'mute' });
    return { say: L('Shh.', 'Shh.', 'Ćśś.'), mood: 'smug' };
  }

  // ---- finestre: chiudi / riduci / passa a (anche schede del browser)
  const wm = RX.win.exec(n);
  if (wm && st.settings.tools.on) {
    const verb = wm[1];
    const name = wm[2].trim();
    const action = /^(close|quit|exit|kill|chiudi|esci da|zamknij)$/.test(verb) ? 'close' : /^(minimi|riduci|zminimal)/.test(verb) ? 'minimize' : 'switch_to';
    const w = await findWindow(name);
    if (w) {
      const isBrowserTab = action === 'close' && BROWSERS.includes(w.exe) && score(w.exe.replace(/\.exe$/, ''), name) < 60;
      await invoke('pet_window_action', { hwnd: w.hwnd, action: isBrowserTab ? 'close_tab' : action });
      const label = isBrowserTab ? `${L('la scheda', 'the tab', 'kartę')} ${name}` : name;
      return {
        say: action === 'close' ? L(`Chiudo ${label}.`, `Closing ${label}.`, `Zamykam ${label}.`) : action === 'minimize' ? L(`Riduco ${label}.`, `Minimized ${label}.`, `Minimalizuję ${label}.`) : L(`Ecco ${label}.`, `Switched to ${label}.`, `Przełączam na ${label}.`),
        mood: 'smug',
        sys: `${action}: ${w.exe || w.title}`,
      };
    }
    if (action !== 'switch_to' && name.split(' ').length <= 2) return { say: L(`Non vedo ${name} aperto.`, `I don't see ${name} open.`, `Nie widzę otwartego ${name}.`), mood: 'think' };
  }

  // ---- primo video di YouTube
  const yt = RX.ytFirst.exec(n);
  if (yt && st.settings.tools.on && st.settings.tools.web) {
    const id = await invoke<string | null>('yt_first', { query: yt[1] }).catch(() => null);
    const url = id ? `https://www.youtube.com/watch?v=${id}` : `https://www.youtube.com/results?search_query=${encodeURIComponent(yt[1])}`;
    await invoke('open_url', { url });
    return { say: id ? L(`Metto ${yt[1]}.`, `Playing ${yt[1]}.`, `Puszczam ${yt[1]}.`) : L(`Cerco ${yt[1]} su YouTube.`, `Searching YouTube for ${yt[1]}.`, `Szukam ${yt[1]} na YouTube.`), mood: 'happy', sys: id ? `youtube ${id}` : 'youtube search' };
  }

  // ---- cartelle e strumenti di Windows
  const op = RX.open.exec(n);
  if (op && st.settings.tools.on) {
    const p = place(op[1].trim());
    if (p) {
      await openTarget(p.target);
      return { say: L(`Apro ${p.label}.`, `Opening ${p.label}.`, `Otwieram ${p.label}.`), mood: 'happy', sys: `open: ${p.target}` };
    }
  }

  // ---- memoria
  if (RX.forgetAll.test(n)) {
    st.clearFacts();
    return { say: L('Fatto. Tabula rasa.', 'Done. Clean slate.', 'Gotowe. Czysta karta.'), mood: 'smug' };
  }
  const fg = RX.forget.exec(n);
  if (fg) {
    const facts = useApp.getState().facts;
    const hit = facts.map((f) => ({ f, s: score(f.text, fg[1]) })).sort((a, b) => b.s - a.s)[0];
    if (hit && hit.s >= 40) {
      st.removeFact(hit.f.id);
      return { say: L('Dimenticato.', 'Forgotten.', 'Zapomniane.'), mood: 'idle', sys: `forget: ${hit.f.text}` };
    }
    return { say: L('Non me lo ricordavo comunque.', "I didn't remember that anyway.", 'I tak tego nie pamiętałam.'), mood: 'smug' };
  }
  const rm = RX.remember.exec(n);
  if (rm) {
    if (SECRET.test(raw)) return { say: L('Quello tienilo per te. I segreti non li tengo.', "Keep that one to yourself. I don't keep secrets.", 'Zatrzymaj to dla siebie. Nie trzymam sekretów.'), mood: 'angry' };
    // il testo originale (con maiuscole e accenti), senza il verbo
    const fact = raw.trim().replace(/^.*?\b(remember(?: that)?|ricorda(?:ti)?(?: che)?|tieni a mente(?: che)?|zapami[eę]taj(?: że| ze)?)\s+/i, '').replace(/[.!]+$/, '');
    st.addFact(fact);
    return { say: L('Segnato.', 'Got it.', 'Zapisane.'), mood: 'happy', sys: `remember: ${fact}` };
  }
  return null;
}

const hm = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
