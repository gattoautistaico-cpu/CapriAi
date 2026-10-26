/**
 * Spotify: Web API con OAuth PKCE (nessun client secret).
 * - play(query): cerca il brano e lo avvia (serve Spotify Premium per il controllo remoto)
 * - fallback senza Premium / senza login: apre il brano/la ricerca nell'app + tasti multimediali
 */
import { invoke } from '@tauri-apps/api/core';
import { fetch as tfetch } from '@tauri-apps/plugin-http';
import { log, useApp } from './store';

const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
const API = 'https://api.spotify.com/v1';

export interface Track {
  name: string;
  artist: string;
  uri: string;
}

const redirectUri = () => `http://127.0.0.1:${useApp.getState().settings.spotify.port}/callback`;

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomString(n: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const v = crypto.getRandomValues(new Uint8Array(n));
  return [...v].map((x) => chars[x % chars.length]).join('');
}

const openUrl = (url: string) => invoke('open_url', { url });
export const mediaKey = (key: 'play_pause' | 'next' | 'prev' | 'stop') => invoke('media_key', { key }).catch(() => undefined);

function saveTokens(j: { access_token: string; refresh_token?: string; expires_in: number }) {
  useApp.getState().setSettings((s) => ({
    ...s,
    spotify: {
      ...s.spotify,
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? s.spotify.refreshToken,
      expiresAt: Date.now() + (j.expires_in - 60) * 1000,
    },
  }));
}

export const spotifyConnected = () => !!useApp.getState().settings.spotify.refreshToken;

/** Login: apre il browser, aspetta il redirect su 127.0.0.1:<porta>/callback. */
export async function connectSpotify(): Promise<void> {
  const sp = useApp.getState().settings.spotify;
  if (!sp.clientId) throw new Error('Inserisci prima il Client ID della tua app Spotify');
  const verifier = randomString(64);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randomString(16);
  const url =
    'https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
      client_id: sp.clientId,
      response_type: 'code',
      redirect_uri: redirectUri(),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SCOPES,
      state,
    }).toString();

  const waiting = invoke<string>('oauth_listen', { port: sp.port, timeoutSec: 180 });
  await new Promise((r) => setTimeout(r, 300));
  await openUrl(url);
  const query = new URLSearchParams(await waiting);
  if (query.get('error')) throw new Error(`Spotify: ${query.get('error')}`);
  if (query.get('state') !== state) throw new Error('Spotify: stato OAuth non valido');
  const code = query.get('code');
  if (!code) throw new Error('Spotify: codice mancante');

  const res = await tfetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: sp.clientId,
      code_verifier: verifier,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Spotify token ${res.status}: ${await res.text()}`);
  saveTokens(await res.json());
  log('ok', 'spotify', 'account collegato');
}

export function disconnectSpotify() {
  useApp.getState().setSettings((s) => ({ ...s, spotify: { ...s.spotify, accessToken: '', refreshToken: '', expiresAt: 0 } }));
}

async function token(): Promise<string | null> {
  const sp = useApp.getState().settings.spotify;
  if (!sp.refreshToken || !sp.clientId) return null;
  if (sp.accessToken && Date.now() < sp.expiresAt) return sp.accessToken;
  const res = await tfetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: sp.refreshToken, client_id: sp.clientId }).toString(),
  });
  if (!res.ok) {
    log('error', 'spotify', `refresh token fallito ${res.status}: ricollega l'account`);
    return null;
  }
  const j = await res.json();
  saveTokens(j);
  return j.access_token;
}

async function api(method: string, path: string, body?: unknown): Promise<Response | null> {
  const t = await token();
  if (!t) return null;
  return tfetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function searchTrack(query: string): Promise<Track | null> {
  const res = await api('GET', `/search?type=track&limit=1&q=${encodeURIComponent(query)}`);
  if (!res || !res.ok) return null;
  const j = await res.json();
  const it = j.tracks?.items?.[0];
  if (!it) return null;
  return { name: it.name, artist: (it.artists ?? []).map((a: { name: string }) => a.name).join(', '), uri: it.uri };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function playUri(uri: string): Promise<boolean> {
  let res = await api('PUT', '/me/player/play', { uris: [uri] });
  if (res && (res.status === 204 || res.ok)) return true;
  if (res && res.status === 404) {
    // nessun dispositivo attivo: usa il primo disponibile, oppure avvia l'app
    let devices = await api('GET', '/me/player/devices');
    let list = devices && devices.ok ? (await devices.json()).devices ?? [] : [];
    if (!list.length) {
      await openUrl('spotify:');
      await sleep(4000);
      devices = await api('GET', '/me/player/devices');
      list = devices && devices.ok ? (await devices.json()).devices ?? [] : [];
    }
    if (list.length) {
      res = await api('PUT', `/me/player/play?device_id=${list[0].id}`, { uris: [uri] });
      if (res && (res.status === 204 || res.ok)) return true;
    }
  }
  if (res && res.status === 403) log('warn', 'spotify', 'controllo remoto non consentito (serve Premium): apro il brano nell\'app');
  return false;
}

/** Avvia un brano. Ritorna il brano trovato (o un'etichetta dalla query). */
export async function play(query: string): Promise<Track> {
  const q = query.trim();
  if (spotifyConnected()) {
    const t = await searchTrack(q);
    if (t) {
      if (await playUri(t.uri)) {
        log('ok', 'spotify', `▶ ${t.name} - ${t.artist}`);
        return t;
      }
      await openUrl(t.uri);
      await sleep(2500);
      await mediaKey('play_pause');
      return t;
    }
  }
  // senza login: apre la ricerca nell'app desktop
  await openUrl(`spotify:search:${encodeURIComponent(q)}`);
  log('info', 'spotify', `ricerca aperta per "${q}" (collega l'account per l'avvio automatico)`);
  return { name: q, artist: '', uri: '' };
}

export async function control(cmd: string): Promise<void> {
  const c = cmd.trim().toLowerCase();
  const map: Record<string, [string, string, 'play_pause' | 'next' | 'prev']> = {
    pause: ['PUT', '/me/player/pause', 'play_pause'],
    stop: ['PUT', '/me/player/pause', 'play_pause'],
    resume: ['PUT', '/me/player/play', 'play_pause'],
    play: ['PUT', '/me/player/play', 'play_pause'],
    next: ['POST', '/me/player/next', 'next'],
    prev: ['POST', '/me/player/previous', 'prev'],
    previous: ['POST', '/me/player/previous', 'prev'],
  };
  const m = map[c];
  if (!m) return;
  const res = spotifyConnected() ? await api(m[0], m[1]) : null;
  if (!res || !(res.ok || res.status === 204)) await mediaKey(m[2]);
  log('info', 'spotify', c);
}

/** Brano in riproduzione (per dare contesto all'AI). */
export async function nowPlaying(): Promise<Track | null> {
  if (!spotifyConnected()) return null;
  try {
    const res = await Promise.race([api('GET', '/me/player/currently-playing'), sleep(1500).then(() => null)]);
    if (!res || res.status !== 200) return null;
    const j = await res.json();
    if (!j.is_playing || !j.item) return null;
    return { name: j.item.name, artist: (j.item.artists ?? []).map((a: { name: string }) => a.name).join(', '), uri: j.item.uri };
  } catch {
    return null;
  }
}
