/**
 * Orchestratore: conversazione, memoria, mood, visione dello schermo.
 */
import { invoke } from '@tauri-apps/api/core';
import { buildSystemPrompt } from './personalities';
import { complete } from './router';
import { activeProfile, log, useApp } from './store';
import { musicControl as control, musicNowPlaying as nowPlaying, musicPlay as play } from './music';
import { SCREEN_RE, findContact, google, openApp, phoneCall, readScreen, webSearch, whatsappChat, youtube } from './actions';
import { speak } from './tts';
import type { ChatMsg } from './types';
import { T } from './i18n';
import { withOverlayHidden } from './capture';
import { clipThat } from './clip';
import { fastCommand } from './commands';
import { moodToy, parseToyTags, runToyCmds, toyPrompt, type ToyCmd } from './lovense';

const history: ChatMsg[] = [];
const MAX_HISTORY = 14;
let queue: Promise<unknown> = Promise.resolve();
let moodTimer: number | undefined;

/** Esegue le richieste una alla volta (evita sovrapposizioni voce/visione). */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

const MUSIC_TOOLS = `Puoi controllare il lettore musicale dell'utente (swiftFree o Spotify).
Per far partire un brano aggiungi alla risposta <play>titolo - artista</play> e annuncialo in carattere (es. "Metto su Titolo - Artista.").
Per i comandi usa <music>pause</music>, <music>resume</music>, <music>next</music>, <music>prev</music>.
Usa questi tag solo se l'utente lo chiede o se è chiaramente opportuno.`;

function toolsPrompt(): string {
  const t = useApp.getState().settings.tools;
  if (!t.on) return '';
  const l = ["Puoi agire sul PC aggiungendo tag alla risposta (l'app li esegue e li nasconde). Usali solo quando l'utente lo chiede:"];
  if (t.apps) l.push("<open>nome app</open> apre un'app installata (es. <open>Discord</open>).");
  l.push('<youtube>ricerca</youtube> cerca su YouTube. <google>ricerca</google> apre una ricerca Google.');
  if (t.web) l.push("<web>ricerca</web> se ti serve un'informazione aggiornata o che non sai: ricevi i risultati e poi rispondi tu.");
  if (t.screen) l.push("<screen/> se l'utente chiede di qualcosa che ha sullo schermo e non ne hai già il contenuto.");
  if (t.calls) l.push('<call>nome o numero</call> chiama dal cellulare collegato. <wacall>nome</wacall> apre la chiamata WhatsApp. <wamsg to="nome">testo</wamsg> prepara un messaggio WhatsApp.');
  if (useApp.getState().settings.clip.enabled) l.push("<clip/> salva un clip degli ultimi secondi di gioco (Medal, AMD o NVIDIA) quando l'utente dice \"clippa\", \"clip that\" o simili.");
  l.push("Annuncia l'azione in carattere, in una frase.");
  return l.join('\n');
}

let musicCtx = '';

function systemPrompt(): string {
  const st = useApp.getState();
  const prof = activeProfile();
  const music = st.settings.spotify.enabled ? `\n\n${MUSIC_TOOLS}${musicCtx ? `\nIn riproduzione ora: ${musicCtx}` : ''}` : '';
  return buildSystemPrompt({
    name: prof?.name ?? 'Nyx',
    personalityId: prof?.personalityId ?? 'tsundere',
    customPrompt: prof?.customPrompt ?? '',
    userName: st.settings.ui.userName,
    facts: st.facts.slice(-40).map((f) => f.text),
    screen: st.status.lastScreen || undefined,
  }) + music + (toolsPrompt() ? `\n\n${toolsPrompt()}` : '') + (toyPrompt() ? `\n\n${toyPrompt()}` : '');
}

function remember(m: ChatMsg) {
  history.push(m);
  while (history.length > MAX_HISTORY) history.shift();
}

export function resetConversation() {
  history.length = 0;
}

export interface Action {
  kind: 'open' | 'youtube' | 'google' | 'call' | 'wacall' | 'wamsg';
  v: string;
  to?: string;
}

export interface Parsed {
  text: string;
  mood: string;
  facts: string[];
  play: string;
  cmds: string[];
  acts: Action[];
  web: string;
  screen: boolean;
  toys: ToyCmd[];
  clip: boolean;
}

/** Estrae mood, memorie, musica e azioni dal testo grezzo del modello. */
export function parseReply(raw: string): Parsed {
  const facts: string[] = [];
  const cmds: string[] = [];
  const acts: Action[] = [];
  let playQ = '';
  let web = '';
  let screen = false;
  let clip = false;
  const toys: ToyCmd[] = [];
  // alcuni modelli (qwen3, deepseek) emettono il ragionamento in <think>
  let text = String(raw ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '');
  text = text.replace(/<ricorda>([\s\S]*?)<\/ricorda>/gi, (_, f: string) => (facts.push(f.trim()), ''));
  text = text.replace(/<play>([\s\S]*?)<\/play>/gi, (_, q: string) => ((playQ = q.trim()), ''));
  text = text.replace(/<(?:spotify|music)>\s*([a-z]+)\s*<\/(?:spotify|music)>/gi, (_, c: string) => (cmds.push(c.toLowerCase()), ''));
  for (const k of ['open', 'youtube', 'google', 'call', 'wacall'] as const) {
    text = text.replace(new RegExp(`<${k}>([\\s\\S]*?)<\\/${k}>`, 'gi'), (_, v: string) => (acts.push({ kind: k, v: v.trim() }), ''));
  }
  text = text.replace(/<wamsg(?:\s+to\s*=\s*"([^"]*)")?\s*>([\s\S]*?)<\/wamsg>/gi, (_, to: string, v: string) => (acts.push({ kind: 'wamsg', to: (to ?? '').trim(), v: v.trim() }), ''));
  text = text.replace(/<web>([\s\S]*?)<\/web>/gi, (_, q: string) => ((web = q.trim()), ''));
  text = text.replace(/<screen\s*\/?>(?:<\/screen>)?/gi, () => ((screen = true), ''));
  text = text.replace(/<clip\s*\/?>(?:<\/clip>)?/gi, () => ((clip = true), ''));
  text = parseToyTags(text, toys);
  let mood = 'idle';
  text = text.replace(/\[mood:\s*([a-z]+)\s*\]/gi, (_, m: string) => ((mood = m.toLowerCase()), ''));
  text = text.replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim();
  return { text, mood, facts, play: playQ, cmds, acts, web, screen, toys, clip };
}

const OFFLINE_LINES = [
  'Link perso con tutti i miei cervelli, choom. Controlla Ollama, le key Gemini o gli altri provider nelle impostazioni.',
  'Zero segnale dalla net. Riprova tra poco o aggiungi un\'altra key.',
  'Tutti i nodi mi hanno chiuso la porta in faccia. Guarda il Log per capire chi.',
];

let lastSrc = '';

/** Conferma di 4 s per le chiamate (annullabile dall'overlay). */
function confirmCall(label: string, run: () => void) {
  useApp.getState().setConfirm({ label, until: Date.now() + 4000, run });
}

async function runActions(acts: Action[]) {
  const st = useApp.getState();
  for (const a of acts) {
    try {
      if (a.kind === 'open') {
        if (!st.settings.tools.apps) continue;
        const got = await openApp(a.v);
        log(got ? 'ok' : 'warn', 'azioni', got ? `aperta ${got}` : `app non trovata: ${a.v}`);
        if (!got) st.setExchange({ sys: `non trovo l'app "${a.v}"` });
      } else if (a.kind === 'youtube') {
        await youtube(a.v);
        log('ok', 'azioni', `YouTube: ${a.v}`);
      } else if (a.kind === 'google') {
        await google(a.v);
        log('ok', 'azioni', `Google: ${a.v}`);
      } else if (a.kind === 'call' || a.kind === 'wacall' || a.kind === 'wamsg') {
        if (!st.settings.tools.calls) continue;
        const c = findContact(a.kind === 'wamsg' ? a.to || a.v : a.v);
        if (!c) throw new Error(`non trovo "${a.to || a.v}" nei contatti (aggiungili in Impostazioni → Strumenti)`);
        if (a.kind === 'wamsg') {
          await whatsappChat(c.phone, a.to ? a.v : '');
          log('ok', 'azioni', `WhatsApp a ${c.name}`);
        } else {
          const wa = a.kind === 'wacall';
          confirmCall(`${wa ? T('WhatsApp a') : T('Chiamo')} ${c.name} · ${c.phone}`, () => {
            const p = wa ? whatsappChat(c.phone) : phoneCall(c.phone);
            p.then(() => log('ok', 'azioni', `${wa ? 'WhatsApp' : 'chiamata'} ${c.name}`)).catch((e) => log('error', 'azioni', String(e)));
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log('warn', 'azioni', msg);
      useApp.getState().setExchange({ sys: msg });
    }
  }
}

async function deliver(raw: string, meta: string) {
  const st = useApp.getState();
  const r = parseReply(raw);
  try {
    if (r.play && st.settings.spotify.enabled) {
      const t = await play(r.play);
      st.setExchange({ np: t.artist ? `${t.name} - ${t.artist}` : t.name });
    }
    for (const c of r.cmds) await control(c === 'previous' ? 'prev' : c);
  } catch (e) {
    log('error', 'musica', String(e));
  }
  r.facts.forEach((f) => {
    st.addFact(f);
    log('info', 'memoria', `ricordato: ${f}`);
  });
  if (st.settings.tools.on && r.acts.length) {
    st.setExchange({ sys: r.acts.map((a) => `${a.kind}: ${a.to ? a.to + ' · ' : ''}${a.v}`).join(' · ') });
    void runActions(r.acts);
  }
  if (r.clip)
    void clipThat()
      .then((c) => {
        if (c.backend === 'skip') return;
        useApp.getState().setCapriFx('clipped');
        useApp.getState().setExchange({ sys: c.file ? `saved ${c.file}` : `clip → ${c.backend}` });
      })
      .catch((e) => log('error', 'clip', String(e instanceof Error ? e.message : e)));
  if (r.toys.length) void runToyCmds(r.toys);
  else void moodToy(r.mood);
  const text = r.text || (r.play ? `${T('Metto su')} ${r.play}.` : r.acts.length || r.clip || r.toys.length ? T('Fatto, choom.') : '…');
  remember({ role: 'assistant', content: text });
  st.pushChat({ role: 'assistant', text, ts: Date.now(), meta });
  st.showBalloon(text, r.mood);
  st.setTransientMood(r.mood);
  window.clearTimeout(moodTimer);
  moodTimer = window.setTimeout(() => useApp.getState().setTransientMood(null), st.settings.ui.balloonSec * 1000);
  const prof = activeProfile();
  if (prof) void speak(text, prof).catch((e) => log('error', 'tts', String(e)));
}

/** Saluto della modalità passiva ("Hey Capri"). */
export function greet(text: string) {
  const st = useApp.getState();
  st.setExchange({ user: '', np: '', sys: '' });
  st.showBalloon(text, 'happy');
  const prof = activeProfile();
  if (prof) void speak(text, prof).catch(() => undefined);
}

export async function ask(userText: string, opts: { voice?: boolean; image?: string; src?: string } = {}): Promise<void> {
  const text = (userText ?? '').trim();
  if (!text && !opts.image) return;
  const st = useApp.getState();
  st.pushChat({ role: 'user', text: text || '[immagine]', ts: Date.now(), meta: opts.voice ? 'voce' : undefined });
  // comandi rapidi (clip, DJ/search mode, musica, apri app…): subito, senza AI e senza coda
  if (!opts.image && (await fastCommand(text))) return;
  st.setExchange({ user: text || '[immagine]', np: '', sys: '' });
  lastSrc = opts.src ?? '';
  return serial(async () => {
    try {
      st.setStatus({ thinking: true });
      st.setTransientMood('think');
      const tools = st.settings.tools;
      if (st.settings.spotify.enabled) {
        const np = await nowPlaying().catch(() => null);
        musicCtx = np ? `${np.name} - ${np.artist}` : '';
      }
      // domanda sullo schermo: leggi subito titolo + testo (OCR) + immagine
      let screenCtx: Awaited<ReturnType<typeof readScreen>> | null = null;
      if (!opts.image && tools.on && tools.screen && (SCREEN_RE.test(text) || /\b(guarda|vedi|cosa sto facendo|look at)\b/i.test(text))) {
        st.setExchange({ sys: 'lettura schermo' });
        screenCtx = await readScreen(true);
      }
      let task: 'chat' | 'vision' = opts.image ? 'vision' : 'chat';
      let user: ChatMsg = opts.image
        ? { role: 'user', content: [{ type: 'text', text: text || 'Guarda questa immagine e commentala in carattere.' }, { type: 'image_url', image_url: { url: opts.image } }] }
        : { role: 'user', content: text };
      if (screenCtx) {
        const ctx = `${text}\n\n[SCHERMO DELL'UTENTE — finestra: ${screenCtx.title || 'sconosciuta'}]\n${screenCtx.text || '(nessun testo letto)'}`;
        user = screenCtx.image ? { role: 'user', content: [{ type: 'text', text: ctx }, { type: 'image_url', image_url: { url: screenCtx.image } }] } : { role: 'user', content: ctx };
        if (screenCtx.image) task = 'vision';
      }
      const base: ChatMsg[] = [{ role: 'system', content: systemPrompt() }, ...history];
      let r = await complete(task, [...base, user], { maxTokens: 900 });
      // seconda fase: il modello ha chiesto il web o lo schermo
      const first = parseReply(r.text);
      if (tools.on && (first.web || (first.screen && !screenCtx))) {
        let results = '';
        let img = '';
        if (first.web && tools.web) {
          st.setExchange({ sys: `web: ${first.web}` });
          const res = await webSearch(first.web);
          results += `[RISULTATI WEB per "${first.web}"]\n` + (res.length ? res.map((x, i) => `${i + 1}. ${x.title} — ${x.snippet} (${x.url})`).join('\n') : 'nessun risultato');
        }
        if (first.screen && tools.screen) {
          st.setExchange({ sys: 'lettura schermo' });
          const sc = await readScreen(true);
          results += `\n[SCHERMO — finestra: ${sc.title || 'sconosciuta'}]\n${sc.text || '(nessun testo letto)'}`;
          img = sc.image;
        }
        const follow = `${results}\n\nUsa queste informazioni per rispondere ora all'utente, in carattere e in breve. Non usare più <web> o <screen/>.`;
        const fu: ChatMsg = img ? { role: 'user', content: [{ type: 'text', text: follow }, { type: 'image_url', image_url: { url: img } }] } : { role: 'user', content: follow };
        try {
          r = await complete(img ? 'vision' : 'chat', [...base, user, { role: 'assistant', content: first.text || '...' }, fu], { maxTokens: 900 });
        } catch (e) {
          log('warn', 'brain', `seconda fase fallita: ${String(e)}`);
          r = { ...r, text: first.text ? `[mood:${first.mood}] ${first.text}` : r.text };
        }
      }
      remember({ role: 'user', content: text || '[immagine]' });
      useApp.getState().setStatus({ thinking: false });
      await deliver(r.text, `${r.provider} · ${r.model}`);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      log('error', 'brain', msg);
      useApp.getState().setStatus({ thinking: false });
      const line = T(OFFLINE_LINES[Math.floor(Math.random() * OFFLINE_LINES.length)]);
      useApp.getState().setTransientMood('sad');
      useApp.getState().showBalloon(line, 'sad');
      const prof = activeProfile();
      if (prof) void speak(line, prof).catch(() => undefined);
    } finally {
      useApp.getState().setStatus({ thinking: false });
    }
  });
}

// ------------------------------------------------------------ visione

const VISION_PROMPT = `Descrivi in massimo 2 frasi in italiano cosa sta facendo l'utente su questo screenshot del suo desktop: applicazione, contenuto principale, eventuali errori visibili.
Ignora barre di sistema e icone. Se lo schermo è vuoto o non c'è nulla di interessante rispondi solo: NIENTE.`;

export async function describeScreen(): Promise<string | null> {
  const s = useApp.getState().settings.vision;
  const b64 = await withOverlayHidden(() => invoke<string>('capture_screen', { maxWidth: s.maxWidth, quality: 70 }));
  const r = await complete(
    'vision',
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ],
      },
    ],
    { maxTokens: 160, temperature: 0.2 },
  );
  const d = r.text.trim();
  if (!d || /^niente\.?$/i.test(d)) return null;
  return d;
}

async function refreshScreen(): Promise<void> {
  try {
    const d = await describeScreen();
    if (d) {
      useApp.getState().setStatus({ lastScreen: d });
      log('info', 'visione', d);
    }
  } catch (e) {
    log('warn', 'visione', String(e));
  }
}

function similarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  wa.forEach((w) => wb.has(w) && inter++);
  return inter / (wa.size + wb.size - inter);
}

let lastReactAt = 0;
let lastReactDesc = '';

/** Un ciclo di osservazione automatica (chiamato a intervalli). */
export function visionTick(force = false): Promise<void> {
  const st = useApp.getState();
  if (!force && (st.status.thinking || st.status.speaking || st.status.listening)) return Promise.resolve();
  return serial(async () => {
    const prev = useApp.getState().status.lastScreen;
    await refreshScreen();
    const cur = useApp.getState().status.lastScreen;
    const vs = useApp.getState().settings.vision;
    if (!cur || (cur === prev && !force)) return;
    const gapOk = Date.now() - lastReactAt > vs.minReactGapSec * 1000;
    if (!force && (!vs.react || !gapOk || similarity(cur, lastReactDesc) > 0.5)) return;
    lastReactAt = Date.now();
    lastReactDesc = cur;
    useApp.getState().setStatus({ thinking: true });
    try {
      const r = await complete(
        'chat',
        [
          { role: 'system', content: systemPrompt() },
          ...history.slice(-4),
          {
            role: 'user',
            content: `[OSSERVAZIONE AUTOMATICA DELLO SCHERMO - non è un messaggio dell'utente]\n${cur}\nFai un commento spontaneo in carattere, massimo una frase. Se non vale la pena commentare rispondi esattamente SKIP.`,
          },
        ],
        { maxTokens: 120 },
      );
      if (!/^\s*(\[mood:[a-z]+\]\s*)?SKIP\b/i.test(r.text)) {
        useApp.getState().setExchange({ user: '', np: '', sys: '' });
        await deliver(r.text, `schermo · ${r.provider}`);
      }
    } catch (e) {
      log('warn', 'visione', String(e));
    } finally {
      useApp.getState().setStatus({ thinking: false });
    }
  });
}
