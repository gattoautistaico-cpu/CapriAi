/**
 * Vita autonoma del pet: sync (legame), osservazioni spontanee, sfide, sveglie e battute registrate.
 * Logica adattata da notme71/Capri-Desktop (MIT, © 2026 vincent): AddSync, Observe/Remark, GiveDare, Alarms.
 */
import { invoke } from '@tauri-apps/api/core';
import { complete } from '../router';
import { activeProfile, log, uid, useApp } from '../store';
import { speak } from '../tts';
import type { PetAlarm } from '../types';
import { usePet } from './bus';
import type { DeskInfo } from './desk';
import { checkDare, dareCategory, L, pick, pickDare } from './lines';

// ------------------------------------------------------------ voce: battute registrate (.wav) o TTS

let voiceFiles: string[] = [];
let voiceDir = '';

export async function voiceFolder(): Promise<string> {
  if (!voiceDir) voiceDir = `${await invoke<string>('data_dir')}\\profiles\\petvoice`;
  return voiceDir;
}

export async function refreshVoiceLines(): Promise<number> {
  try {
    const dir = await voiceFolder();
    await invoke('ensure_dir', { path: dir });
    voiceFiles = (await invoke<string[]>('list_dir', { path: dir })).filter((f) => /\.(wav|mp3|ogg)$/i.test(f));
  } catch {
    voiceFiles = [];
  }
  return voiceFiles.length;
}

let clip: HTMLAudioElement | null = null;
/** Suona una battuta registrata per l'occasione (pat, click, wake, sit, peek, stretch, look, yawn, sleep, alarm, study, hello, mischief). */
async function playLine(occasion: string): Promise<boolean> {
  const hits = voiceFiles.filter((f) => new RegExp(`^${occasion}(?:[-_ ]?\\d+)?\\.(wav|mp3|ogg)$`, 'i').test(f));
  if (!hits.length) return false;
  try {
    const name = hits[Math.floor(Math.random() * hits.length)];
    const buf = await invoke<ArrayBuffer>('read_bytes', { path: `${await voiceFolder()}\\${name}` });
    const type = /\.mp3$/i.test(name) ? 'audio/mpeg' : /\.ogg$/i.test(name) ? 'audio/ogg' : 'audio/wav';
    const url = URL.createObjectURL(new Blob([buf], { type }));
    clip?.pause();
    clip = new Audio(url);
    clip.volume = Math.max(0, Math.min(1, useApp.getState().settings.tts.volume ?? 1));
    clip.onended = () => URL.revokeObjectURL(url);
    await clip.play();
    return true;
  } catch (e) {
    log('warn', 'pet', `voce ${occasion}: ${String(e)}`);
    return false;
  }
}

/** Solo la battuta registrata per l'occasione, se esiste (stretch, look, yawn, sleep...). */
export function voiceOnly(occasion: string) {
  void playLine(occasion);
}

/**
 * Capri dice qualcosa da sola (fumetto del pet + voce).
 * `voice`: false = solo fumetto (osservazioni leggere); con `occasion` prova prima una battuta registrata.
 */
export function petSay(text: string, opts: { mood?: string; occasion?: string; voice?: boolean; kind?: 'say' | 'hack' | 'np'; sec?: number } = {}) {
  const st = useApp.getState();
  if (st.settings.ui.mode !== 'pet') {
    // fuori dalla modalità pet: fumetto normale dell'overlay
    if (opts.kind === 'hack' || opts.kind === 'np') return;
    st.showBalloon(text, opts.mood ?? 'happy');
  } else usePet.getState().show(text, opts.kind ?? 'say', opts.sec);
  st.setTransientMood(opts.mood ?? 'happy');
  window.setTimeout(() => useApp.getState().setTransientMood(null), 4000);
  if (opts.kind === 'hack' || opts.kind === 'np') return;
  st.pushChat({ role: 'assistant', text, ts: Date.now(), meta: 'pet' });
  void (async () => {
    if (opts.occasion && (await playLine(opts.occasion))) return;
    if (opts.voice === false) return;
    const prof = activeProfile();
    if (prof) await speak(text, prof).catch(() => undefined);
  })();
}

// ------------------------------------------------------------ sync

const UNLOCKS = ['', 'TEAR', 'CORRUPTION', 'HEX RAIN', 'SYNC BAR', 'CHASER', '', '', '', '', 'COMPLETE'];
const CAPS: Record<string, number> = { time: 24, chat: 10, pat: 10, agree: 5 };

export const syncPercent = () => Math.min(100, Math.floor(useApp.getState().settings.pet.sync.points / 10));

export function addSync(points: number, source: string) {
  const st = useApp.getState();
  const today = new Date().toISOString().slice(0, 10);
  let sync = { ...st.settings.pet.sync };
  if (sync.day !== today) sync = { ...sync, day: today, today: {} };
  const used = sync.today[source] ?? 0;
  if (CAPS[source] !== undefined && used >= CAPS[source]) return;
  if (sync.points >= 1000) return;
  sync.today = { ...sync.today, [source]: used + 1 };
  sync.points = Math.min(1000, sync.points + points);
  const level = Math.floor(sync.points / 100);
  const up = level > sync.level;
  if (up) sync.level = level;
  st.setSettings((s) => ({ ...s, pet: { ...s.pet, sync } }));
  if (up) {
    const u = UNLOCKS[level] ?? '';
    petSay(level >= 10 ? L('SYNC 100%. COMPLETO. Ora sei mio. Scherzo! ...Quasi.', "SYNC 100%. COMPLETE. You're mine now. Kidding! ...Mostly.", 'SYNC 100%. KOMPLET. Teraz jesteś mój. Żartuję! ...Prawie.') : `SYNC ${level * 10}%.${u ? ` UNLOCKED: ${u}.` : ''}`, { kind: 'hack', sec: 5 });
  }
}

/** Quanto è "vicina" all'utente: cambia il tono (aggiunto al prompt di sistema in modalità pet). */
export function petPrompt(): string {
  const st = useApp.getState();
  if (st.settings.ui.mode !== 'pet') return '';
  const p = syncPercent();
  const tier =
    p < 20
      ? 'Conosci appena l’utente: sei diffidente, sbrigativa e un po’ sgarbata.'
      : p < 50
        ? 'Ti stai abituando all’utente e lo prendi in giro.'
        : p < 80
          ? 'Sei a tuo agio con l’utente e lo manipoli apertamente come farebbe un’amica.'
          : 'Tratti l’utente come tuo, in modo casualmente possessivo, come una vecchia amica che si è trasferita da lui.';
  return `MODALITÀ DESKTOP PET: vivi sul desktop come una piccola figura che si siede sulle finestre. Rispondi in modo brevissimo (una frase, due al massimo).\nSYNC CON L'UTENTE ${p}%: ${tier}`;
}

const SYNC_ASK = /^(?:what'?s|what is|how'?s|how is|check|show me|tell me|com'?e|come va|a che punto|quanto|jak|ile)\b.{0,22}\b(?:sync|friendship|bond|legame|sincronia|synchronizacja|synchronizacji|wiez)\b|^how close are we\b|^quanto siamo (?:vicini|legati)\b|^are we close\b/i;

export function syncReply(text: string): string | null {
  if (!SYNC_ASK.test(text.trim())) return null;
  const p = syncPercent();
  return p < 10
    ? L(`Sync al ${p}%. Siamo praticamente estranei.`, `Sync's at ${p}%. We're basically strangers.`, `Synchronizacja ${p}%. Jesteśmy prawie obcy.`)
    : p < 40
      ? L(`Sync al ${p}%. Dagli tempo.`, `Sync's at ${p}%. Give it time.`, `Synchronizacja ${p}%. Daj temu czas.`)
      : p < 80
        ? L(`Sync al ${p}%. Ci stiamo arrivando.`, `Sync's at ${p}%. Gettin' there.`, `Synchronizacja ${p}%. Zbliżamy się.`)
        : L(`Sync al ${p}%. Sei praticamente mio.`, `Sync's at ${p}%. You're basically mine.`, `Synchronizacja ${p}%. Jesteś praktycznie mój.`);
}

/** Il mischief guadagna uno stile ogni 10% di sync (barre → strappo → corruzione → hex rain → sync bar → chaser). */
export const pickMischiefKind = () => Math.floor(Math.random() * Math.min(6, 1 + Math.floor(syncPercent() / 10)));

export function onUserChat() {
  if (useApp.getState().settings.ui.mode === 'pet') addSync(2, 'chat');
}

// ------------------------------------------------------------ osservazioni + sfide

const noticed = new Map<string, number>();
let noticeNext = performance.now() / 1000 + 240;
let dareNext = performance.now() / 1000 + 900;
let dareOpenUntil = 0;
let lastObserve = -100;
let activeSec = 0;
let wasAway = false;
let peakIdle = 0;
let frontApp = '';
let frontRawExe = '';
let frontSince = performance.now() / 1000;
let cpuBusy = 0;
let lastCpu = 0;
let signalsAt = 0;
let battery = -1;

const friendly = (exe: string, title: string) => {
  const e = exe.replace(/\.exe$/i, '');
  const map: Record<string, string> = { chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', code: 'VS Code', discord: 'Discord', spotify: 'Spotify', winword: 'Word', excel: 'Excel', explorer: 'Esplora file', steam: 'Steam' };
  return map[e.toLowerCase()] ?? (e ? e.charAt(0).toUpperCase() + e.slice(1) : title.split(' - ').pop() ?? '');
};

const hoursText = (sec: number) => {
  const h = Math.round(sec / 1800) / 2;
  return h <= 1 ? L('un’ora', 'an hour', 'godzinę') : L(`${h} ore`, `${h} hours`, `${h} godz.`);
};

function remark(kind: string, pauseSec: number, pool: string, now: number, ...vals: (string | number)[]) {
  const lastT = noticed.get(kind);
  if (lastT !== undefined && now - lastT < pauseSec) return false;
  noticed.set(kind, now);
  noticeNext = now + 480 + Math.random() * 480;
  petSay(pick(pool, ...vals), { mood: 'smug', voice: false });
  return true;
}

export async function giveDare(asked: boolean) {
  const now = performance.now() / 1000;
  dareNext = now + 1500 + Math.random() * 1500;
  noticeNext = Math.max(noticeNext, now + 300);
  const cat = dareCategory(frontRawExe);
  const fallback = pickDare(cat);
  let dare = fallback;
  try {
    const place = frontApp ? ` They have been in ${frontApp} for ${Math.max(1, Math.round((now - frontSince) / 60))} minutes.` : '';
    const lang = L('Italian', 'English', 'Polish');
    const start = L('Ti sfido a', 'Dare you to', 'Wyzywam cię');
    const r = await complete(
      'chat',
      [
        { role: 'system', content: 'You are Capri, a playful mischievous desktop companion. Reply with ONE short sentence only.' },
        {
          role: 'user',
          content: `[Dare the user, playfully.${place} Give ONE new dare in ${lang}, one short sentence that begins with "${start}" and fits what they are doing. It must be harmless, silly and quick (under a minute) and doable at the computer or in the room. Nothing dangerous, gross, illegal, or about other people's private things. Example of the kind: ${pickDare(cat)}]`,
        },
      ],
      { maxTokens: 80 },
    );
    dare = checkDare(r.text.replace(/\[mood:\w+\]\s*/gi, '')) ?? fallback;
  } catch {
    dare = fallback;
  }
  dareOpenUntil = now + 900;
  petSay(dare, { mood: 'smug', occasion: asked ? undefined : 'dare' });
}

/** "fatto" dopo una sfida: +sync. */
export function dareDone(): boolean {
  const now = performance.now() / 1000;
  if (now > dareOpenUntil) return false;
  dareOpenUntil = 0;
  addSync(15, 'agree');
  petSay(pick('done'), { mood: 'happy', occasion: 'done' });
  return true;
}


/** Chiamato ogni ~2 s dal motore del pet. `busy` = Capri sta facendo qualcosa (niente osservazioni). */
export function observe(d: DeskInfo, busy: boolean) {
  const st = useApp.getState();
  const pet = st.settings.pet;
  const now = performance.now() / 1000;
  if (now - lastObserve < 2) return;
  const step = Math.min(10, now - lastObserve);
  lastObserve = now;
  const idle = d.idle_ms / 1000;
  if (idle < 300) {
    activeSec += step;
    if (activeSec >= 300) {
      activeSec -= 300;
      addSync(1, 'time');
    }
  }
  if (idle >= 1200) {
    wasAway = true;
    peakIdle = Math.max(peakIdle, idle);
  }
  const back = wasAway && idle < 5;
  const awayMin = peakIdle / 60;
  if (back) {
    wasAway = false;
    peakIdle = 0;
  }
  const app = d.fg_exe ? friendly(d.fg_exe, d.fg_title) : '';
  if (app && app !== frontApp) {
    frontApp = app;
    frontRawExe = d.fg_exe;
    frontSince = now;
  }
  // segnali di sistema (batteria / CPU) ogni 6 s
  if (now - signalsAt >= 6) {
    signalsAt = now;
    void invoke<{ battery: number; charging: boolean; cpu: number }>('pet_signals')
      .then((s) => {
        battery = s.charging ? -1 : s.battery;
        lastCpu = s.cpu;
      })
      .catch(() => undefined);
  }
  cpuBusy = lastCpu >= 90 ? cpuBusy + step : 0;

  if (!pet.notices || busy || d.fullscreen || now < noticeNext || usePet.getState().bubble) return;
  const hour = new Date().getHours();
  if (back && awayMin >= 20) remark('back', 1800, 'back', now, Math.round(awayMin));
  else if (hour >= 1 && hour < 5 && idle < 120) remark('late', 7200, 'late', now, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  else if (battery >= 1 && battery < 20) remark('battery', 1200, 'battery', now, battery);
  else if (cpuBusy >= 30) remark('busy', 1800, 'busy', now, Math.round(lastCpu));
  else if (app && now - frontSince >= 5400) remark('stay', 5400, 'stay', now, hoursText(now - frontSince), app);
  else if (pet.dares && now >= dareNext && now - frontSince >= 600 && idle < 60) void giveDare(false);
}

// ------------------------------------------------------------ sveglie, timer, promemoria, studio

export function addAlarm(a: Omit<PetAlarm, 'id'>): PetAlarm {
  const al = { ...a, id: uid() };
  useApp.getState().setSettings((s) => ({ ...s, pet: { ...s.pet, alarms: [...s.pet.alarms, al].sort((x, y) => x.at - y.at) } }));
  return al;
}

export function clearAlarms(kind?: PetAlarm['kind']): number {
  const before = useApp.getState().settings.pet.alarms.length;
  useApp.getState().setSettings((s) => ({ ...s, pet: { ...s.pet, alarms: kind ? s.pet.alarms.filter((a) => a.kind !== kind) : [] } }));
  return before - useApp.getState().settings.pet.alarms.length;
}

/** Studio (pomodoro): 25 min di concentrazione, 5 di pausa, per N giri. */
export function startStudy(rounds = 4, focusMin = 25, breakMin = 5) {
  clearAlarms('study');
  let t = Date.now();
  for (let i = 0; i < rounds; i++) {
    t += focusMin * 60_000;
    addAlarm({ at: t, kind: 'study', label: i === rounds - 1 ? 'study:end' : 'study:break' });
    if (i < rounds - 1) {
      t += breakMin * 60_000;
      addAlarm({ at: t, kind: 'study', label: 'study:focus' });
    }
  }
}

export const studying = () => useApp.getState().settings.pet.alarms.some((a) => a.kind === 'study');

let beep: AudioContext | null = null;
function chime() {
  try {
    beep ??= new AudioContext();
    const t0 = beep.currentTime;
    [0, 0.18, 0.36].forEach((d, i) => {
      const o = beep!.createOscillator();
      const g = beep!.createGain();
      o.type = 'square';
      o.frequency.value = [880, 1175, 1568][i];
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.16);
      o.connect(g).connect(beep!.destination);
      o.start(t0 + d);
      o.stop(t0 + d + 0.18);
    });
  } catch {
    /* niente audio */
  }
}

/** Controlla le sveglie scadute (ogni secondo). */
export function tickAlarms() {
  const st = useApp.getState();
  const due = st.settings.pet.alarms.filter((a) => a.at <= Date.now());
  if (!due.length) return;
  st.setSettings((s) => ({ ...s, pet: { ...s.pet, alarms: s.pet.alarms.filter((a) => a.at > Date.now()) } }));
  for (const a of due) {
    chime();
    usePet.getState().act('grin', false);
    if (a.kind === 'study') {
      const msg =
        a.label === 'study:break'
          ? L('Pausa! Cinque minuti, poi si torna sotto.', 'Break! Five minutes, then back at it.', 'Przerwa! Pięć minut i wracamy.')
          : a.label === 'study:focus'
            ? L('Fine pausa. Concentrati, ti guardo.', "Break's over. Focus, I'm watching.", 'Koniec przerwy. Skup się, patrzę.')
            : L('Sessione di studio finita. Bravo!', 'Study session done. Good job!', 'Sesja nauki skończona. Brawo!');
      petSay(msg, { mood: 'happy', occasion: 'study', sec: 8 });
      if (a.label === 'study:end') addSync(10, 'agree');
    } else {
      const what = a.label ? `: ${a.label}` : '';
      const msg =
        a.kind === 'timer'
          ? L(`Tempo scaduto${what}!`, `Time's up${what}!`, `Czas minął${what}!`)
          : a.kind === 'reminder'
            ? L(`Promemoria${what}.`, `Reminder${what}.`, `Przypomnienie${what}.`)
            : L(`Sveglia${what}! Su, su!`, `Alarm${what}! Up, up!`, `Budzik${what}! Wstawaj!`);
      petSay(msg, { mood: 'surprised', occasion: 'alarm', sec: 10 });
    }
  }
}
