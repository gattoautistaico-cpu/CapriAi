/**
 * Client per swiftFree (Swiftify con sorgenti gratuite).
 * Protocollo: docs/SWIFTFREE_API.md
 *  - Desktop: HTTP locale  http://127.0.0.1:47800  (Bearer token opzionale)
 *  - Fallback / Android: deep link  swiftfree://play?q=...  swiftfree://control/next
 */
import { invoke } from '@tauri-apps/api/core';
import { fetch as tfetch } from '@tauri-apps/plugin-http';
import { log, useApp } from './store';
import type { Track } from './spotify';

const cfg = () => useApp.getState().settings.music.swiftfree;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 4000): Promise<Response> {
  const c = cfg();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await tfetch(`${c.baseUrl.replace(/\/+$/, '')}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

export interface SwiftStatus {
  app: string;
  version: string;
  playing: boolean;
  track: { title: string; artist: string; source?: string } | null;
}

export async function swiftStatus(): Promise<SwiftStatus | null> {
  try {
    const res = await call('GET', '/api/v1/status', undefined, 1200);
    if (!res.ok) return null;
    return (await res.json()) as SwiftStatus;
  } catch {
    return null;
  }
}

/** Avvia swiftFree se non risponde (percorso exe nelle impostazioni). */
async function ensureRunning(): Promise<boolean> {
  if (await swiftStatus()) return true;
  const c = cfg();
  if (!c.autoLaunch || !c.exePath) return false;
  try {
    await invoke('start_service', { tag: 'swiftfree', exe: c.exePath, args: ['--control-server'] });
  } catch (e) {
    log('warn', 'swiftfree', `avvio fallito: ${String(e)}`);
    return false;
  }
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await swiftStatus()) {
      log('ok', 'swiftfree', 'avviato');
      return true;
    }
  }
  return false;
}

const deepLink = (path: string) => invoke('open_url', { url: `swiftfree://${path}` });

export async function swiftPlay(query: string): Promise<Track> {
  if (await ensureRunning()) {
    const res = await call('POST', '/api/v1/play', { query }, 15000);
    if (res.ok) {
      const j = await res.json();
      const t = j.track ?? {};
      log('ok', 'swiftfree', `▶ ${t.title ?? query}${t.artist ? ' - ' + t.artist : ''}${t.source ? ' [' + t.source + ']' : ''}`);
      return { name: t.title ?? query, artist: t.artist ?? '', uri: t.id ?? '' };
    }
    log('warn', 'swiftfree', `play ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }
  await deepLink(`play?q=${encodeURIComponent(query)}`);
  log('info', 'swiftfree', `deep link play "${query}"`);
  return { name: query, artist: '', uri: '' };
}

export async function swiftControl(cmd: string): Promise<void> {
  const c = cmd.trim().toLowerCase().replace(/^previous$/, 'prev').replace(/^stop$/, 'pause').replace(/^play$/, 'resume');
  if (!['pause', 'resume', 'next', 'prev'].includes(c)) return;
  if (await swiftStatus()) {
    const res = await call('POST', '/api/v1/control', { action: c });
    if (res.ok) return;
  }
  await deepLink(`control/${c}`);
}

export async function swiftNowPlaying(): Promise<Track | null> {
  const s = await swiftStatus();
  if (!s?.playing || !s.track) return null;
  return { name: s.track.title, artist: s.track.artist, uri: '' };
}
