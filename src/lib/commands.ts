/**
 * Comandi rapidi locali: si eseguono SUBITO, senza passare dall'AI (latenza minima).
 * clip, DJ mode, search mode, cancel, musica (pausa/avanti/indietro), apri app, YouTube, Google.
 * In DJ mode la frase successiva è un brano; in search mode è una ricerca su YouTube.
 */
import { google, norm, openApp, youtube } from './actions';
import { clipThat, isClipCommand } from './clip';
import { T } from './i18n';
import { musicControl, musicPlay } from './music';
import { activeProfile, log, useApp } from './store';
import { speak } from './tts';
import { runErrand } from './pet/errands';

/** Toglie "hey capri," / "capri" dall'inizio della frase. */
function stripWake(text: string): string {
  const s = useApp.getState().settings;
  let t = text.trim();
  const words = (s.passive.words || 'hey capri')
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)
    .concat([activeProfile()?.name ?? 'capri']);
  for (const w of words.sort((a, b) => b.length - a.length)) {
    const re = new RegExp('^\\s*' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s,.:!?-]*', 'i');
    if (re.test(t)) {
      t = t.replace(re, '');
      break;
    }
  }
  return t.trim();
}

/** Risposta locale: terminale + fumetto + voce, come una risposta dell'AI. */
export function say(text: string, mood = 'happy', sys = '') {
  const st = useApp.getState();
  if (sys) st.setExchange({ sys });
  st.pushChat({ role: 'assistant', text, ts: Date.now(), meta: 'locale' });
  st.showBalloon(text, mood);
  st.setTransientMood(mood);
  const prof = activeProfile();
  if (prof) void speak(text, prof).catch(() => undefined);
}

function setMode(m: 'normal' | 'dj' | 'search') {
  const st = useApp.getState();
  if (st.capriMode !== m) st.setCapriFx('rewiring');
  st.setCapriMode(m);
}

const RX = {
  dj: /^(dj mode|dj|modalita dj|modalita d j|modo dj|tryb dj|music mode|modalita musica)$/,
  search: /^(search mode|modalita (di )?ricerca|modalita cerca|tryb wyszukiwania|tryb szukania)$/,
  cancel: /^(cancel|annulla|basta|esci|stop|normal mode|modalita normale|torna normale|back to normal|anuluj|wyjdz|koniec|tryb normalny)$/,
  pause: /^(pausa|metti in pausa|pause|stop (la )?musica|stop music|ferma (la )?musica|pauza|zatrzymaj( muzyke)?)$/,
  resume: /^(riprendi|play|resume|continua|wznow|graj dalej)$/,
  next: /^(prossima|avanti|next|skip|salta|cambia (canzone|brano)|nastepna|dalej)$/,
  prev: /^(precedente|indietro|previous|prev|torna indietro|poprzednia)$/,
  open: /^(apri|open|avvia|lancia|otworz|uruchom)\s+(.+)$/,
  youtube1: /^(?:cerca|cercami|search|metti|play|wyszukaj|szukaj)\s+(.+?)\s+(?:su|on|na)\s+youtube$/,
  youtube2: /^youtube\s+(.+)$/,
  google1: /^(?:cerca|cercami|search|wyszukaj|szukaj)\s+(.+?)\s+(?:su|on|w|na)\s+google$/,
  google2: /^(?:google|googla|googlami|googluj)\s+(.+)$/,
};

/** Esegue un comando rapido. Ritorna true se la frase è stata gestita (niente AI). */
export async function fastCommand(raw: string): Promise<boolean> {
  const st = useApp.getState();
  const text = stripWake(raw);
  const n = norm(text);
  if (!n) return false;
  const mode = st.capriMode;
  try {
    // ---- clip
    if (isClipCommand(raw) || (st.settings.clip.enabled && /^(clip that|clip it|clip|clippa|clippalo|clippala|klip|klipnij|nagraj to)$/.test(n))) {
      st.setExchange({ user: text, np: '', sys: '' });
      const r = await clipThat();
      if (r.backend === 'skip') return true;
      st.setCapriFx('clipped');
      const secs = st.settings.replay.seconds || 30;
      const reply = st.settings.clip.reply || (r.file ? T('Clippato! Ecco gli ultimi') + ` ${secs} ` + T('secondi, salvati.') : T('Clippato, choom.') + ` [${r.backend.toUpperCase()}]`);
      say(reply, 'happy', r.file ? `saved ${r.file}` : `clip → ${r.backend}`);
      return true;
    }
    // ---- uscita dalle modalità
    if (RX.cancel.test(n) && mode !== 'normal') {
      st.setExchange({ user: text, np: '', sys: '' });
      setMode('normal');
      say(T('Ok, si torna alla normalità.'), 'idle');
      return true;
    }
    // ---- ingresso nelle modalità
    if (RX.dj.test(n)) {
      st.setExchange({ user: text, np: '', sys: '' });
      setMode('dj');
      say(T('Ooh, ora di musica. Cosa vuoi sentire?'), 'happy');
      return true;
    }
    if (RX.search.test(n)) {
      st.setExchange({ user: text, np: '', sys: '' });
      setMode('search');
      say(T('Modalità ricerca. Cosa cerchiamo?'), 'think');
      return true;
    }
    // ---- musica
    for (const k of ['pause', 'resume', 'next', 'prev'] as const) {
      if (RX[k].test(n)) {
        st.setExchange({ user: text, np: '', sys: '' });
        await musicControl(k);
        say(T(k === 'pause' ? 'Pausa.' : k === 'resume' ? 'Si riparte.' : k === 'next' ? 'Prossima.' : 'Quella di prima.'), 'smug');
        return true;
      }
    }
    // ---- commissioni (timer, sveglie, studio, volume, finestre, cartelle, YouTube, memoria, sync, sfide)
    const er = await runErrand(text);
    if (er) {
      st.setExchange({ user: text, np: '', sys: er.sys ?? '' });
      if (er.say) say(er.say, er.mood ?? 'happy');
      return true;
    }
    // ---- DJ mode: la frase è il brano
    if (mode === 'dj') {
      st.setExchange({ user: text, np: '', sys: '' });
      const t = await musicPlay(text);
      const np = t.artist ? `${t.name} - ${t.artist}` : t.name || text;
      st.setExchange({ np });
      say(`${T('Metto su')} ${np}.`, 'happy');
      return true;
    }
    // ---- search mode: la frase è la ricerca (YouTube, oppure "google …")
    if (mode === 'search') {
      st.setExchange({ user: text, np: '', sys: '' });
      const g = RX.google2.exec(n) || RX.google1.exec(n);
      if (g) {
        await google(text.replace(/^\s*(google|googla|googlami|googluj)\s+/i, ''));
        say(`${T('Cerco su Google')} ${g[1]}.`, 'think');
      } else {
        await youtube(text);
        say(`${T('Cerco su YouTube')} ${text}. ${T('Quale metto?')}`, 'think');
      }
      return true;
    }
    // ---- apri app / YouTube / Google
    const yt = RX.youtube1.exec(n) || RX.youtube2.exec(n);
    if (yt && st.settings.tools.on) {
      st.setExchange({ user: text, np: '', sys: '' });
      await youtube(yt[1]);
      say(`${T('Cerco su YouTube')} ${yt[1]}.`, 'happy');
      return true;
    }
    const gg = RX.google1.exec(n) || RX.google2.exec(n);
    if (gg && st.settings.tools.on) {
      st.setExchange({ user: text, np: '', sys: '' });
      await google(gg[1]);
      say(`${T('Cerco su Google')} ${gg[1]}.`, 'happy');
      return true;
    }
    const op = RX.open.exec(n);
    if (op && st.settings.tools.on && st.settings.tools.apps && op[2].split(' ').length <= 4) {
      const got = await openApp(op[2]);
      if (got) {
        st.setExchange({ user: text, np: '', sys: `open: ${got}` });
        say(`${T('Apro')} ${got}.`, 'happy');
        return true;
      }
      // non trovata: lascio decidere all'AI (magari era una frase diversa)
    }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    log('error', 'comandi', msg);
    st.setExchange({ sys: msg });
    say(T('Qualcosa è andato storto, choom.'), 'sad');
    return true;
  }
  return false;
}
