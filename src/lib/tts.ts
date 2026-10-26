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

export function stopSpeaking(): void {
  try {
    source?.stop();
  } catch {
    /* già fermo */
  }
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

export async function speak(raw: string, profile: Profile): Promise<void> {
  const s = useApp.getState().settings;
  const engine = profile.voice.engine === 'default' ? s.tts.engine : profile.voice.engine;
  const text = cleanForSpeech(raw);
  if (!text || engine === 'off') return;
  const lang = (s.stt.language || 'it').slice(0, 2);
  stopSpeaking();
  useApp.getState().setStatus({ speaking: true });
  try {
    if (engine === 'piper') {
      const model = profile.voice.piperModel || s.tts.piperModel;
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
