/**
 * Text-to-Speech: Piper (locale, offline) -> voci Windows (Web Speech, offline)
 * -> ElevenLabs (cloud, opzionale). Espone il livello audio per il lip sync.
 */
import { invoke } from '@tauri-apps/api/core';
import { fetch as tfetch } from '@tauri-apps/plugin-http';
import { log, useApp } from './store';
import type { Profile } from './types';

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: AudioBufferSourceNode | null = null;
let level = 0;
let fakeTimer: number | undefined;
let rafId = 0;

/** 0..1, livello voce corrente (usato dall'avatar per la bocca). */
export const getVoiceLevel = () => level;

function ensureCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function meter() {
  if (!analyser) return;
  const data = new Float32Array(analyser.fftSize);
  const tick = () => {
    analyser!.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    level = level * 0.5 + Math.min(1, rms * 5) * 0.5;
    rafId = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(rafId);
  tick();
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function playBuffer(buf: ArrayBuffer, volume: number): Promise<void> {
  const c = ensureCtx();
  const audio = await c.decodeAudioData(buf);
  const gain = c.createGain();
  gain.gain.value = volume;
  const src = c.createBufferSource();
  src.buffer = audio;
  src.connect(gain);
  gain.connect(analyser!);
  source = src;
  meter();
  await new Promise<void>((resolve) => {
    src.onended = () => resolve();
    src.start();
  });
  cancelAnimationFrame(rafId);
  source = null;
  level = 0;
}

// ------------------------------------------------------------ voce "Undertale" (blip)

let blipNodes: OscillatorNode[] = [];
let blipDone: (() => void) | null = null;

/**
 * Un blip per lettera, sincronizzato con la macchina da scrivere del terminale
 * (stessa velocità in caratteri/s). Niente sintesi vocale: zero latenza.
 */
function speakBlips(text: string, volume: number): Promise<void> {
  const st = useApp.getState().settings;
  const b = st.tts.blips;
  const c = ensureCtx();
  const step = 1 / Math.max(5, st.capri.typeCps || 32);
  const t0 = c.currentTime + 0.03;
  let last = -1;
  blipNodes = [];
  [...text].forEach((ch, i) => {
    if (!/[\p{L}\p{N}]/u.test(ch)) return;
    const t = t0 + i * step;
    if (t - last < 0.045) return;
    last = t;
    const osc = c.createOscillator();
    osc.type = b.wave;
    // vocali leggermente più acute, piccola variazione casuale come in Undertale
    const vowel = /[aeiouàèéìòùy]/i.test(ch) ? 1.06 : 1;
    osc.frequency.setValueAtTime(b.pitch * vowel * (1 + (Math.random() * 2 - 1) * b.variance), t);
    const g = c.createGain();
    const len = Math.min(0.075, step * 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, b.volume * volume), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g);
    g.connect(analyser!);
    osc.start(t);
    osc.stop(t + len + 0.01);
    blipNodes.push(osc);
  });
  meter();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => finish(), (text.length * step + 0.2) * 1000);
    const finish = () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(rafId);
      level = 0;
      blipDone = null;
      resolve();
    };
    blipDone = finish;
  });
}

export function stopSpeaking(): void {
  try {
    source?.stop();
  } catch {
    /* già fermo */
  }
  blipNodes.forEach((o) => {
    try {
      o.stop();
    } catch {
      /* già fermo */
    }
  });
  blipNodes = [];
  blipDone?.();
  window.speechSynthesis?.cancel();
  window.clearInterval(fakeTimer);
  level = 0;
  useApp.getState().setStatus({ speaking: false });
}

export function webVoices(): SpeechSynthesisVoice[] {
  return window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}

function pickWebVoice(name: string, lang: string): SpeechSynthesisVoice | undefined {
  const voices = webVoices();
  if (name) {
    const v = voices.find((x) => x.name === name);
    if (v) return v;
  }
  const female = /elsa|isabella|paola|zira|aria|jenny|nanami|haruka|ayumi|female|donna/i;
  const byLang = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  return byLang.find((v) => female.test(v.name)) ?? byLang[0] ?? voices[0];
}

function speakWeb(text: string, profile: Profile, volume: number, lang: string): Promise<void> {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickWebVoice(profile.voice.webVoice, lang);
    if (v) u.voice = v;
    u.rate = profile.voice.webRate;
    u.pitch = profile.voice.webPitch;
    u.volume = volume;
    // nessun accesso al segnale audio: lip sync simulato
    fakeTimer = window.setInterval(() => {
      level = 0.25 + Math.random() * 0.6;
    }, 90);
    const done = () => {
      window.clearInterval(fakeTimer);
      level = 0;
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    // alcune voci non chiamano mai onend: sblocca comunque
    window.setTimeout(done, 4000 + text.length * 120);
    window.speechSynthesis.speak(u);
  });
}

/** Pulisce il testo per la sintesi (tag, simboli, url). */
export function cleanForSpeech(t: string): string {
  return t
    .replace(/<ricorda>[\s\S]*?<\/ricorda>/gi, '')
    .replace(/\[mood:[a-z]+\]/gi, '')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[*_`#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Voce Piper predefinita per lingua (installate da install.bat nella cartella voices). */
const PIPER_LANG: Record<string, string> = { it: 'it_IT-paola-medium.onnx', en: 'en_US-amy-medium.onnx', pl: 'pl_PL-gosia-medium.onnx' };
const modelCache = new Map<string, string>();

/** Se il modello scelto è di un'altra lingua, usa la voce della lingua corrente nella stessa cartella (se esiste). */
async function piperModelFor(model: string, lang: string): Promise<string> {
  if (!model) return model;
  const base = model.split(/[\\/]/).pop() ?? '';
  if (base.toLowerCase().startsWith(lang + '_') || !PIPER_LANG[lang]) return model;
  const key = model + '|' + lang;
  if (modelCache.has(key)) return modelCache.get(key)!;
  const alt = model.slice(0, model.length - base.length) + PIPER_LANG[lang];
  let out = model;
  try {
    if (await invoke<boolean>('path_exists', { path: alt })) out = alt;
    else {
      // una voce italiana che legge il polacco suona male: meglio la voce di Windows della lingua giusta
      out = '';
      log('warn', 'tts', `voce Piper per "${lang}" non trovata (${PIPER_LANG[lang]}): uso la voce di Windows. Scaricala da Impostazioni → Voce.`);
    }
  } catch {
    /* niente */
  }
  modelCache.set(key, out);
  return out;
}

/** Scarica la voce Piper della lingua nella cartella della voce predefinita. */
export async function downloadPiperVoice(lang: string): Promise<string> {
  const s = useApp.getState().settings;
  const name = PIPER_LANG[lang];
  if (!name) throw new Error('lingua senza voce Piper: ' + lang);
  const dir = s.tts.piperModel ? s.tts.piperModel.slice(0, s.tts.piperModel.length - (s.tts.piperModel.split(/[\\/]/).pop() ?? '').length) : '';
  if (!dir) throw new Error('imposta prima la voce Piper predefinita');
  const stem = name.replace(/\.onnx$/, '');
  const [loc, spk, q] = stem.split('-');
  const url = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${loc.slice(0, 2)}/${loc}/${spk}/${q}/${stem}`;
  await invoke('download_file', { url: url + '.onnx.json', dest: dir + name + '.json' });
  await invoke('download_file', { url: url + '.onnx', dest: dir + name });
  modelCache.clear();
  return dir + name;
}

export async function speak(raw: string, profile: Profile): Promise<void> {
  const s = useApp.getState().settings;
  const engine = profile.voice.engine === 'default' ? s.tts.engine : profile.voice.engine;
  const text = cleanForSpeech(raw);
  if (!text || engine === 'off') return;
  if (engine === 'blips') {
    stopSpeaking();
    useApp.getState().setStatus({ speaking: true });
    try {
      await speakBlips(text, s.tts.volume);
    } finally {
      useApp.getState().setStatus({ speaking: false });
    }
    return;
  }
  const lang = (s.stt.language || 'it').slice(0, 2);
  stopSpeaking();
  useApp.getState().setStatus({ speaking: true });
  try {
    if (engine === 'piper') {
      const model = await piperModelFor(profile.voice.piperModel || s.tts.piperModel, lang);
      if (!s.tts.piperExe || !model) throw new Error('Piper non configurato');
      const b64 = await invoke<string>('piper_tts', {
        exe: s.tts.piperExe,
        model,
        text,
        speaker: profile.voice.piperSpeaker,
        lengthScale: profile.voice.lengthScale,
      });
      await playBuffer(b64ToBuf(b64), s.tts.volume);
      return;
    }
    if (engine === 'elevenlabs') {
      if (!s.tts.elevenKey || !profile.voice.elevenVoiceId) throw new Error('ElevenLabs non configurato');
      const res = await tfetch(`https://api.elevenlabs.io/v1/text-to-speech/${profile.voice.elevenVoiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': s.tts.elevenKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
      });
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
      await playBuffer(await res.arrayBuffer(), s.tts.volume);
      return;
    }
    await speakWeb(text, profile, s.tts.volume, lang);
  } catch (e) {
    log('warn', 'tts', `${engine} fallito (${String(e)}) → voce Windows`);
    await speakWeb(text, profile, s.tts.volume, lang);
  } finally {
    level = 0;
    useApp.getState().setStatus({ speaking: false });
  }
}
