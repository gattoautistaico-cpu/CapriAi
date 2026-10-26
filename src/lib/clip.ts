/**
 * Clip con comando vocale ("Capri clip that", "Capri clippa"): preme il tasto rapido
 * del software di registrazione attivo. Medal, AMD Adrenalin (Instant Replay),
 * NVIDIA (ShadowPlay / NVIDIA App, Instant Replay) o Xbox Game Bar come ripiego.
 */
import { invoke } from '@tauri-apps/api/core';
import { norm } from './actions';
import { T } from './i18n';
import { replayRunning, saveReplay } from './replay';
import { log, useApp } from './store';
import type { ClipBackend } from './types';

/** Processi che indicano il software di clip attivo (nomi di tasklist, minuscoli). */
const PROCS: Record<Exclude<ClipBackend, 'auto' | 'capri' | 'gamebar' | 'custom'>, string[]> = {
  medal: ['medal.exe', 'medalencoder.exe'],
  amd: ['radeonsoftware.exe', 'amdrsserv.exe', 'amdrssrcext.exe'],
  nvidia: ['nvidia share.exe', 'nvidia overlay.exe', 'nvidia app.exe'],
};

let procCache: { t: number; list: string[] } = { t: 0, list: [] };

async function processes(): Promise<string[]> {
  if (Date.now() - procCache.t < 30000) return procCache.list;
  try {
    procCache = { t: Date.now(), list: await invoke<string[]>('running_processes') };
  } catch (e) {
    log('warn', 'clip', `elenco processi non disponibile: ${String(e)}`);
  }
  return procCache.list;
}

/** Backend attivi in ordine di preferenza (Medal → AMD → NVIDIA → Game Bar). */
export async function detectClipBackends(): Promise<ClipBackend[]> {
  const ps = await processes();
  const out: ClipBackend[] = [];
  if (await replayRunning()) out.push('capri');
  for (const k of ['medal', 'amd', 'nvidia'] as const) if (PROCS[k].some((p) => ps.includes(p))) out.push(k);
  out.push('gamebar');
  return out;
}

let lastClip = 0;

export interface ClipResult {
  backend: string;
  /** file salvato (solo instant replay di Capri) */
  file?: string;
}

/** Salva il clip con l'instant replay di Capri o con il tasto del programma di registrazione. */
export async function clipThat(): Promise<ClipResult> {
  const c = useApp.getState().settings.clip;
  if (Date.now() - lastClip < 3000) return { backend: 'skip' }; // stessa frase trascritta due volte
  lastClip = Date.now();
  const backend = c.backend === 'auto' ? (await detectClipBackends())[0] : c.backend;
  if (backend === 'capri') {
    const file = await saveReplay();
    if (c.sound) beep();
    return { backend, file };
  }
  const combo = c.hotkeys[backend as keyof typeof c.hotkeys] || '';
  if (!combo) throw new Error(T('nessun tasto rapido impostato per') + ' ' + backend);
  await invoke('send_hotkey', { combo });
  log('ok', 'clip', `${backend}: ${combo}`);
  if (c.sound) beep();
  return { backend };
}

/** true se la frase trascritta è un comando di clip. */
export function isClipCommand(heard: string): boolean {
  const s = useApp.getState().settings;
  if (!s.clip.enabled) return false;
  const h = norm(heard);
  if (!h) return false;
  for (const p of s.clip.phrases.split(',')) {
    const w = norm(p);
    if (w && (h === w || h.includes(w))) return true;
  }
  // "capri ... clip/clippa/klip" anche se whisper storpia il resto della frase
  const wake = (s.passive.words || 'capri').split(',').map((w) => norm(w).split(' ').pop() ?? '').filter((w) => w.length >= 4);
  return wake.some((w) => h.includes(w)) && /\b(clip\w*|klip\w*|clipp\w*)\b/.test(h) && h.split(' ').length <= 6;
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.setValueAtTime(1320, ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.05, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.23);
    o.onended = () => void ctx.close();
  } catch {
    /* niente audio */
  }
}
