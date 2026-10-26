/**
 * Speech-to-Text: microfono -> WAV 16 kHz -> whisper.cpp server locale.
 * Fallback cloud: Gemini (input_audio) tramite il router.
 * Modalità push-to-talk (hotkey) o ascolto continuo con VAD a energia.
 */
import { invoke } from '@tauri-apps/api/core';
import { fetch as tfetch } from '@tauri-apps/plugin-http';
import { complete } from './router';
import { log, useApp } from './store';

const TARGET_RATE = 16000;

// --------------------------------------------------------------- WAV

function downsample(input: Float32Array, from: number): Float32Array {
  if (from === TARGET_RATE) return input;
  const ratio = from / TARGET_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const pcm = downsample(samples, rate);
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, TARGET_RATE, true);
  v.setUint32(28, TARGET_RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function multipart(fields: Record<string, string>, file: { name: string; field: string; data: Uint8Array; type: string }) {
  const boundary = '----cyberai' + Math.random().toString(16).slice(2);
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [k, val] of Object.entries(fields)) {
    chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${val}\r\n`));
  }
  chunks.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
  );
  chunks.push(file.data);
  chunks.push(enc.encode(`\r\n--${boundary}--\r\n`));
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const body = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    body.set(c, o);
    o += c.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// --------------------------------------------------------------- whisper server

const HALLUCINATIONS = [
  /^\s*\[.*\]\s*$/,
  /sottotitoli/i,
  /amara\.org/i,
  /^\s*(grazie( per la visione)?|thank you\.?)\s*$/i,
];

export function cleanTranscript(t: string): string {
  const s = t.replace(/\[[A-Z_ ]+\]/g, '').replace(/\s+/g, ' ').trim();
  if (!s || HALLUCINATIONS.some((r) => r.test(s))) return '';
  return s;
}

const whisperUrl = () => `http://127.0.0.1:${useApp.getState().settings.stt.port}`;

export async function ensureWhisper(): Promise<boolean> {
  const s = useApp.getState().settings.stt;
  if (s.mode !== 'whisper') return false;
  if (await pingWhisper()) {
    useApp.getState().setStatus({ sttReady: true });
    return true;
  }
  if (!s.autoStart || !s.whisperExe || !s.whisperModel) {
    log('warn', 'stt', 'whisper-server non attivo e non configurato per l’avvio automatico');
    return false;
  }
  try {
    await invoke('start_service', {
      tag: 'whisper',
      exe: s.whisperExe,
      args: ['-m', s.whisperModel, '--host', '127.0.0.1', '--port', String(s.port), '-t', String(s.threads), '-l', s.language || 'auto'],
    });
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await pingWhisper()) {
        log('ok', 'stt', `whisper-server pronto su :${s.port}`);
        useApp.getState().setStatus({ sttReady: true });
        return true;
      }
    }
    log('error', 'stt', 'whisper-server avviato ma non risponde');
  } catch (e) {
    log('error', 'stt', String(e));
  }
  useApp.getState().setStatus({ sttReady: false });
  return false;
}

async function pingWhisper(): Promise<boolean> {
  try {
    const res = await tfetch(whisperUrl(), { method: 'GET', connectTimeout: 800 });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function whisperTranscribe(wav: Uint8Array): Promise<string> {
  const s = useApp.getState().settings.stt;
  const { body, contentType } = multipart(
    { response_format: 'json', temperature: '0.0', language: s.language || 'auto' },
    { field: 'file', name: 'audio.wav', data: wav, type: 'audio/wav' },
  );
  const res = await tfetch(`${whisperUrl()}/inference`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
  if (!res.ok) throw new Error(`whisper ${res.status}`);
  const j = await res.json();
  return String(j.text ?? '');
}

async function cloudTranscribe(wav: Uint8Array): Promise<string> {
  const r = await complete(
    'stt',
    [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Trascrivi esattamente questo audio. Rispondi solo con il testo trascritto, senza commenti.' },
          { type: 'input_audio', input_audio: { data: toB64(wav), format: 'wav' } },
        ],
      },
    ],
    { temperature: 0, maxTokens: 300 },
  );
  return r.text;
}

export async function transcribe(wav: Uint8Array): Promise<string> {
  const mode = useApp.getState().settings.stt.mode;
  if (mode === 'off') return '';
  if (mode === 'whisper') {
    try {
      const t = cleanTranscript(await whisperTranscribe(wav));
      log('ok', 'stt', `whisper: "${t.slice(0, 60)}"`);
      return t;
    } catch (e) {
      log('warn', 'stt', `whisper fallito (${String(e)}) → cloud`);
    }
  }
  try {
    return cleanTranscript(await cloudTranscribe(wav));
  } catch (e) {
    log('error', 'stt', `trascrizione cloud fallita: ${String(e)}`);
    return '';
  }
}

// --------------------------------------------------------------- microfono

type Handler = (wav: Uint8Array) => void;

class Mic {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private proc: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private preroll: Float32Array[] = [];
  private recording = false;
  private continuous = false;
  /** registra una frase e si ferma da solo al silenzio (click sull'avatar Capri) */
  private oneShot = false;
  private heard = false;
  private loudFrames = 0;
  private silentMs = 0;
  private onUtterance: Handler | null = null;
  level = 0;

  async open(onUtterance: Handler) {
    this.onUtterance = onUtterance;
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
    src.connect(this.proc);
    this.proc.connect(this.ctx.destination);
    this.proc.onaudioprocess = (e) => this.onFrame(e.inputBuffer.getChannelData(0));
  }

  private onFrame(d: Float32Array) {
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / d.length);
    this.level = rms;
    const copy = new Float32Array(d);
    const frameMs = (d.length / (this.ctx?.sampleRate ?? 48000)) * 1000;
    const st = useApp.getState();

    if (this.recording) {
      this.chunks.push(copy);
      if (this.continuous || this.oneShot) {
        const quiet = rms < st.settings.stt.vadThreshold;
        if (!quiet) this.heard = true;
        this.silentMs = quiet ? this.silentMs + frameMs : 0;
        // one-shot: aspetta che l'utente inizi a parlare (max 7 s) prima di chiudere al silenzio
        if (this.heard ? this.silentMs > 900 : this.silentMs > 7000) this.finish();
        if (this.chunks.length * frameMs > 30_000) this.finish();
      }
      return;
    }
    if (!this.continuous || st.status.speaking || st.status.thinking) return;
    this.preroll.push(copy);
    if (this.preroll.length > 3) this.preroll.shift();
    this.loudFrames = rms > st.settings.stt.vadThreshold ? this.loudFrames + 1 : 0;
    if (this.loudFrames >= 2) this.begin();
  }

  private begin() {
    this.chunks = [...this.preroll];
    this.recording = true;
    this.silentMs = 0;
    this.heard = this.continuous && !this.oneShot;
    useApp.getState().setStatus({ listening: true });
  }

  private finish() {
    this.recording = false;
    this.oneShot = false;
    this.loudFrames = 0;
    useApp.getState().setStatus({ listening: false });
    const rate = this.ctx?.sampleRate ?? 48000;
    const total = this.chunks.reduce((a, c) => a + c.length, 0);
    if (total / rate < 0.45) return;
    const all = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) {
      all.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    this.onUtterance?.(encodeWav(all, rate));
  }

  listenOnce() {
    if (this.recording) {
      this.finish();
      return;
    }
    this.oneShot = true;
    this.begin();
  }

  get isRecording() {
    return this.recording;
  }

  pushToTalk(down: boolean) {
    if (down && !this.recording) this.begin();
    else if (!down && this.recording) this.finish();
  }

  setContinuous(on: boolean) {
    this.continuous = on;
    if (!on && this.recording) this.finish();
  }

  async close() {
    this.proc?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.proc = null;
  }
}

export const mic = new Mic();
