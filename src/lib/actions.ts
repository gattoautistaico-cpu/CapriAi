/**
 * Azioni sul PC richieste da Capri (stesse funzioni della versione Android):
 * aprire app, ricerca YouTube/Google, ricerca web con risposta, lettura schermo,
 * chiamate (tel: -> Collegamento al telefono) e WhatsApp.
 */
import { invoke } from '@tauri-apps/api/core';
import { httpSafe } from './router';
import { log, useApp } from './store';
import type { Contact } from './types';

const openUrl = (url: string) => invoke('open_url', { url });

export function norm(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Somiglianza semplice: uguale > inizia con > contiene > parole in comune. */
export function score(name: string, q: string): number {
  const a = norm(name);
  const b = norm(q);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.startsWith(b) || b.startsWith(a)) return 80;
  if (a.includes(b) || b.includes(a)) return 60;
  return b.split(' ').filter((w) => w.length > 1 && a.includes(w)).length * 20;
}

// ------------------------------------------------------------ app

let appsCache: { t: number; list: { Name: string; AppID: string }[] } | null = null;

export async function listApps(): Promise<{ Name: string; AppID: string }[]> {
  if (appsCache && Date.now() - appsCache.t < 600_000) return appsCache.list;
  try {
    const raw = await invoke<string>('list_apps');
    const j = JSON.parse(raw || '[]');
    const list = (Array.isArray(j) ? j : [j]).filter((x) => x && x.Name && x.AppID);
    appsCache = { t: Date.now(), list };
    return list;
  } catch (e) {
    log('error', 'app', `elenco app non disponibile: ${String(e)}`);
    return appsCache?.list ?? [];
  }
}

export async function openApp(name: string): Promise<string> {
  const list = await listApps();
  let best = 0;
  let pick: { Name: string; AppID: string } | null = null;
  for (const a of list) {
    const s = score(a.Name, name);
    if (s > best) {
      best = s;
      pick = a;
    }
  }
  if (!pick || best < 40) return '';
  await invoke('open_app', { appId: pick.AppID });
  return pick.Name;
}

// ------------------------------------------------------------ ricerche

export const youtube = (q: string) => openUrl('https://www.youtube.com/results?search_query=' + encodeURIComponent(q));
export const google = (q: string) => openUrl('https://www.google.com/search?q=' + encodeURIComponent(q));

export interface WebResult {
  title: string;
  snippet: string;
  url: string;
}

/** DuckDuckGo HTML, poi Wikipedia come ripiego. Non lancia mai. */
export async function webSearch(q: string): Promise<WebResult[]> {
  const out: WebResult[] = [];
  try {
    const r = await httpSafe(
      'POST',
      'https://html.duckduckgo.com/html/',
      { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
      'q=' + encodeURIComponent(q) + '&kl=it-it',
      12000,
    );
    if (r.status === 200) {
      const doc = new DOMParser().parseFromString(r.body, 'text/html');
      doc.querySelectorAll('.result').forEach((el) => {
        if (out.length >= 6) return;
        const a = el.querySelector('.result__a');
        if (!a) return;
        out.push({
          title: a.textContent?.trim() ?? '',
          snippet: el.querySelector('.result__snippet')?.textContent?.trim() ?? '',
          url: el.querySelector('.result__url')?.textContent?.trim() ?? '',
        });
      });
    }
  } catch (e) {
    log('warn', 'web', `duckduckgo: ${String(e)}`);
  }
  if (!out.length) {
    try {
      const lang = (useApp.getState().settings.stt.language || 'it').slice(0, 2).replace('au', 'it');
      const r = await httpSafe('GET', `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=4&srsearch=${encodeURIComponent(q)}`, {}, undefined, 10000);
      const j = JSON.parse(r.body || '{}');
      for (const x of j?.query?.search ?? []) out.push({ title: x.title, snippet: String(x.snippet ?? '').replace(/<[^>]+>/g, ''), url: `${lang}.wikipedia.org` });
    } catch (e) {
      log('warn', 'web', `wikipedia: ${String(e)}`);
    }
  }
  log(out.length ? 'ok' : 'warn', 'web', `"${q}" → ${out.length} risultati`);
  return out;
}

// ------------------------------------------------------------ schermo

export const SCREEN_RE =
  /\b(schermo|schermata|sto (guardando|leggendo|vedendo)|cosa (c'è|vedo)|questa (pagina|chat|app|foto|immagine|mail|email|notizia|finestra)|questo (articolo|messaggio|post|video|testo|errore|codice)|leggi(mi)?|riassumi(mi)?|traducimi|on (my )?screen|what am i looking at)\b/i;

/** Ultimo titolo di finestra che non sia Cyber AI (aggiornato in background). */
let lastTitle = '';
export function trackForeground() {
  window.setInterval(async () => {
    try {
      const t = await invoke<string>('foreground_title');
      if (t && !/^cyber ai$/i.test(t.trim())) lastTitle = t;
    } catch {
      /* non Windows */
    }
  }, 2000);
}

export interface ScreenRead {
  title: string;
  text: string;
  image: string;
}

/** Titolo finestra + testo OCR + screenshot (per la visione). Non lancia mai. */
export async function readScreen(withImage: boolean): Promise<ScreenRead> {
  const s = useApp.getState().settings;
  const [text, image] = await Promise.all([
    invoke<string>('ocr_screen').catch((e) => {
      log('warn', 'schermo', `OCR: ${String(e).slice(0, 120)}`);
      return '';
    }),
    withImage
      ? invoke<string>('capture_screen', { maxWidth: s.vision.maxWidth, quality: 70 })
          .then((b) => `data:image/jpeg;base64,${b}`)
          .catch(() => '')
      : Promise.resolve(''),
  ]);
  log('info', 'schermo', `letto: "${lastTitle}" · ${text.length} caratteri${image ? ' + immagine' : ''}`);
  return { title: lastTitle, text, image };
}

// ------------------------------------------------------------ contatti e chiamate

export function findContact(q: string): Contact | null {
  const digits = q.replace(/[^0-9+]/g, '');
  if (/^[+0-9][0-9 ()\-]{5,}$/.test(q.trim())) return { id: 'n', name: q.trim(), phone: digits };
  const list = useApp.getState().settings.contacts;
  let best = 0;
  let pick: Contact | null = null;
  for (const c of list) {
    const s = score(c.name, q);
    if (s > best) {
      best = s;
      pick = c;
    }
  }
  return best >= 40 ? pick : null;
}

function waNumber(phone: string): string {
  let n = phone.replace(/[^0-9+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (n.length === 10 && n.startsWith('3')) n = '39' + n;
  return n;
}

/** tel: apre "Collegamento al telefono" (o l'app predefinita) che chiama dal cellulare. */
export const phoneCall = (phone: string) => openUrl('tel:' + phone.replace(/[^0-9+]/g, ''));

/** WhatsApp Desktop: apre la chat (la chiamata si avvia con il pulsante in alto). */
export const whatsappChat = (phone: string, text = '') =>
  openUrl(`whatsapp://send?phone=${waNumber(phone)}${text ? '&text=' + encodeURIComponent(text) : ''}`).catch(() =>
    openUrl(`https://wa.me/${waNumber(phone)}${text ? '?text=' + encodeURIComponent(text) : ''}`),
  );
