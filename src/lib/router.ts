/**
 * Router AI (stessa logica della versione Android):
 *   PC/locale (Ollama, LM Studio) -> Gemini multi-key -> altri provider free
 *   (Groq, Cerebras, Mistral, GitHub Models, NVIDIA, HF, Cloudflare) -> OpenRouter :free
 * Ogni errore (rete, timeout, 4xx/5xx, JSON rotto, risposta vuota, 200 con {error})
 * passa al tentativo successivo. Scadenza complessiva 60 s, 30 s per chiamata.
 */
import { fetch as tfetch } from '@tauri-apps/plugin-http';
import { log, useApp } from './store';
import type { ChatMsg, GeminiKey, Task } from './types';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    public retryAfterSec?: number,
  ) {
    super(`HTTP ${status || 'rete'}: ${String(body).slice(0, 200)}`);
  }
}

export interface CallResult {
  text: string;
  provider: string;
  model: string;
}

export interface CallOpts {
  maxTokens?: number;
  temperature?: number;
  /** ms totali disponibili (default 60 s) */
  deadlineMs?: number;
  noVisionRetry?: boolean;
}

function parseRetry(res: Response | null, body: string): number | undefined {
  const h = res?.headers.get('retry-after');
  if (h && !Number.isNaN(Number(h))) return Number(h);
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(Number(m[1])) : undefined;
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** HTTP che non lancia mai: {status, body}; status 0 = rete/timeout. */
export async function httpSafe(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: string,
  timeoutMs = 30000,
): Promise<{ status: number; body: string; res: Response | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await tfetch(url, { method, headers, body: method === 'GET' ? undefined : body, signal: ctrl.signal, connectTimeout: Math.min(timeoutMs, 10000) });
    const text = await res.text();
    return { status: res.status, body: text, res };
  } catch (e) {
    return { status: 0, body: ctrl.signal.aborted ? `timeout ${Math.round(timeoutMs / 1000)}s` : String(e), res: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Estrae il testo da una risposta OpenAI-compatibile o lancia HttpError. */
export function extractText(status: number, body: string): string {
  const j = safeJson(body);
  if (!j) throw new HttpError(status || 502, 'JSON non valido: ' + body.slice(0, 80));
  if (j.error) {
    const msg = j.error.message ?? JSON.stringify(j.error);
    const code = Number(j.error.code) || (/rate|quota/i.test(msg) ? 429 : 502);
    throw new HttpError(code, msg);
  }
  const ch = j.choices?.[0];
  if (!ch) throw new HttpError(502, 'nessuna choice');
  const c = ch.message ? ch.message.content : ch.text;
  let text = Array.isArray(c) ? c.map((p: { text?: string }) => p?.text ?? '').join('') : String(c ?? '');
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!text) throw new HttpError(502, 'risposta vuota' + (ch.finish_reason ? ` (${ch.finish_reason})` : ''));
  return text;
}

async function openaiChat(
  base: string,
  key: string,
  model: string,
  messages: ChatMsg[],
  opts: CallOpts,
  timeoutMs: number,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const r = await httpSafe(
    'POST',
    `${base.replace(/\/+$/, '')}/chat/completions`,
    { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extraHeaders },
    JSON.stringify({ model, messages, max_tokens: opts.maxTokens ?? 900, temperature: opts.temperature ?? 0.8, stream: false }),
    timeoutMs,
  );
  if (r.status < 200 || r.status >= 300) throw new HttpError(r.status, r.body, parseRetry(r.res, r.body));
  return extractText(r.status, r.body);
}

/** Chiamata singola a un provider (per i pulsanti "Prova" nelle impostazioni). */
export const testChat = (base: string, key: string, model: string) =>
  openaiChat(base, key, model, [{ role: 'user', content: 'Rispondi solo: ok' }], { maxTokens: 20 }, 20000);

// ------------------------------------------------------------ stato key / modelli

interface KeyState {
  cooldownUntil: number;
  invalid: boolean;
  ok: number;
  fail: number;
  lastError: string;
}
const keyState = new Map<string, KeyState>();
const badGeminiModels = new Set<string>();
const modelCd = new Map<string, number>();
export const providerCd = new Map<string, number>();
let rr = 0;
let pcHealth = { ok: null as boolean | null, t: 0 };

function ks(id: string): KeyState {
  let s = keyState.get(id);
  if (!s) {
    s = { cooldownUntil: 0, invalid: false, ok: 0, fail: 0, lastError: '' };
    keyState.set(id, s);
  }
  return s;
}

export function geminiKeyStatus(id: string): { label: string; tone: 'ok' | 'warn' | 'error' | 'idle' } {
  const s = keyState.get(id);
  if (!s) return { label: 'pronta', tone: 'idle' };
  if (s.invalid) return { label: 'non valida', tone: 'error' };
  const left = Math.ceil((s.cooldownUntil - Date.now()) / 1000);
  if (left > 0) return { label: `cooldown ${left}s`, tone: 'warn' };
  return { label: `ok ${s.ok} · err ${s.fail}`, tone: 'ok' };
}

export function resetGeminiKeys(): void {
  keyState.clear();
  badGeminiModels.clear();
  modelCd.clear();
  providerCd.clear();
  pcHealth = { ok: null, t: 0 };
}

function rotatedKeys(keys: GeminiKey[]): { k: GeminiKey; idx: number }[] {
  const now = Date.now();
  const usable = keys
    .map((k, idx) => ({ k, idx }))
    .filter(({ k }) => k.enabled && k.key.trim() && !ks(k.id).invalid && ks(k.id).cooldownUntil <= now);
  if (!usable.length) return [];
  const start = rr % usable.length;
  return [...usable.slice(start), ...usable.slice(0, start)];
}

// ------------------------------------------------------------ OpenRouter free

interface OrModel {
  id: string;
  vision: boolean;
  audio: boolean;
  ctx: number;
}
let freeCache: { ts: number; models: OrModel[] } | null = null;

export async function openRouterFreeModels(force = false): Promise<OrModel[]> {
  if (!force && freeCache && Date.now() - freeCache.ts < 3600_000) return freeCache.models;
  const r = await httpSafe('GET', `${OPENROUTER_BASE}/models`, {}, undefined, 15000);
  const j = safeJson(r.body);
  if (!j || !Array.isArray(j.data)) {
    if (freeCache) return freeCache.models;
    throw new HttpError(r.status, 'lista modelli non disponibile');
  }
  const models: OrModel[] = j.data
    .filter((m: any) => m?.id && (m.id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0')))
    .filter((m: any) => !m.id.startsWith('openrouter/'))
    .map((m: any) => {
      const mods: string[] = m.architecture?.input_modalities ?? [];
      const modality: string = m.architecture?.modality ?? '';
      return { id: m.id, vision: mods.includes('image') || modality.includes('image'), audio: mods.includes('audio'), ctx: m.context_length ?? 0 };
    })
    .sort((a: OrModel, b: OrModel) => b.ctx - a.ctx);
  freeCache = { ts: Date.now(), models };
  log('info', 'openrouter', `${models.length} modelli gratuiti disponibili`);
  return models;
}

// ------------------------------------------------------------ router

function setActive(provider: string, model: string) {
  useApp.getState().setStatus({ provider, model });
}

async function pcAlive(baseUrl: string): Promise<boolean> {
  if (pcHealth.ok !== null && Date.now() - pcHealth.t < 45000) return pcHealth.ok === true;
  const r = await httpSafe('GET', `${baseUrl.replace(/\/+$/, '')}/models`, {}, undefined, 2500);
  pcHealth = { ok: r.status === 200, t: Date.now() };
  if (!pcHealth.ok) log('warn', 'local', `server locale non raggiungibile, salto (${r.status || r.body.slice(0, 40)})`);
  return pcHealth.ok === true;
}

function textOnly(messages: ChatMsg[]): ChatMsg[] {
  return messages.map((m) =>
    Array.isArray(m.content)
      ? { role: m.role, content: m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n') + '\n[immagine non disponibile]' }
      : m,
  );
}

const asErr = (e: unknown) => (e instanceof HttpError ? e : new HttpError(0, e instanceof Error ? e.message : String(e)));

export async function complete(task: Task, messages: ChatMsg[], opts: CallOpts = {}): Promise<CallResult> {
  const s = useApp.getState().settings;
  const errors: string[] = [];
  const deadline = Date.now() + (opts.deadlineMs ?? 60000);
  const left = () => deadline - Date.now();
  const callMs = () => Math.max(1500, Math.min(left(), 30000));

  for (const p of s.order) {
    if (left() < 1500) break;
    try {
      // ---------------- LOCALE
      if (p === 'local' && s.local.enabled && task !== 'stt') {
        const model = task === 'vision' ? s.local.visionModel || s.local.chatModel : s.local.chatModel;
        if (model && (await pcAlive(s.local.baseUrl))) {
          try {
            const text = await openaiChat(s.local.baseUrl, s.local.apiKey, model, messages, opts, Math.min(callMs(), s.local.timeoutSec * 1000));
            setActive('local', model);
            log('ok', 'local', `${task} · ${model}`);
            return { text, provider: 'local', model };
          } catch (e) {
            const err = asErr(e);
            errors.push(`locale: ${err.status || 'rete'}`);
            log('warn', 'local', `${task} · ${model} → ${err.message}`);
            if (!err.status) pcHealth = { ok: false, t: Date.now() };
          }
        }
      }

      // ---------------- GEMINI multi-key
      if (p === 'gemini' && s.gemini.enabled && s.gemini.keys.length) {
        const order = rotatedKeys(s.gemini.keys);
        if (!order.length) errors.push('gemini: key in cooldown o non valide');
        keys: for (const { k, idx } of order) {
          const st = ks(k.id);
          const tag = k.label || `#${idx + 1}`;
          for (const model of s.gemini.models) {
            if (badGeminiModels.has(model)) continue;
            if (left() < 1500) break keys;
            try {
              const text = await openaiChat(GEMINI_BASE, k.key.trim(), model, messages, opts, callMs());
              st.ok++;
              rr = idx + 1;
              setActive('gemini', `${model} · ${tag}`);
              log('ok', 'gemini', `${task} · ${model} · ${tag}`);
              return { text, provider: 'gemini', model };
            } catch (e) {
              const err = asErr(e);
              st.fail++;
              st.lastError = err.message;
              errors.push(`gemini ${tag}: ${err.status || 'rete'}`);
              if (err.status === 429) {
                const sec = err.retryAfterSec ?? s.gemini.cooldownSec;
                st.cooldownUntil = Date.now() + sec * 1000;
                log('warn', 'gemini', `${tag} quota/429 → cooldown ${sec}s, ruoto key`);
                continue keys;
              }
              if (err.status === 401 || err.status === 403 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(err.body)) {
                st.invalid = true;
                log('error', 'gemini', `${tag} non valida o disabilitata`);
                continue keys;
              }
              if (err.status === 404 || (err.status === 400 && /model/i.test(err.body) && /not found|unsupported|invalid/i.test(err.body))) {
                badGeminiModels.add(model);
                log('warn', 'gemini', `modello ${model} non disponibile, provo il prossimo`);
                continue;
              }
              log('warn', 'gemini', `${tag} · ${model} → ${err.message}`);
            }
          }
        }
      }

      // ---------------- ALTRI PROVIDER FREE
      if (p === 'extra' && task !== 'stt') {
        for (const pv of s.extra) {
          if (!pv.enabled || !pv.key.trim() || !pv.base || /ACCOUNT_ID/.test(pv.base)) continue;
          if ((providerCd.get(pv.id) ?? 0) > Date.now()) continue;
          const list = (task === 'vision' ? pv.vision : pv.models).split(',').map((x) => x.trim()).filter(Boolean);
          for (const m of list) {
            const mk = `${pv.id}:${m}`;
            if ((modelCd.get(mk) ?? 0) > Date.now() || left() < 1500) continue;
            try {
              const text = await openaiChat(pv.base, pv.key.trim(), m, messages, opts, callMs());
              setActive(pv.id, m);
              log('ok', pv.id, `${task} · ${m}`);
              return { text, provider: pv.id, model: m };
            } catch (e) {
              const err = asErr(e);
              errors.push(`${pv.id}: ${err.status || 'rete'}`);
              if (err.status === 401 || err.status === 403) {
                providerCd.set(pv.id, Date.now() + 600_000);
                log('error', pv.id, 'key non valida o senza permessi (pausa 10 min)');
                break;
              }
              if (err.status === 429) {
                const sec = err.retryAfterSec ?? 60;
                providerCd.set(pv.id, Date.now() + sec * 1000);
                log('warn', pv.id, `limite raggiunto, pausa ${sec}s`);
                break;
              }
              modelCd.set(mk, Date.now() + (err.status === 404 || err.status === 400 ? 1_800_000 : 120_000));
              log('warn', pv.id, `${m} → ${err.message}`);
            }
          }
        }
      }

      // ---------------- OPENROUTER free
      if (p === 'openrouter' && s.openrouter.enabled && s.openrouter.key.trim()) {
        let candidates: string[] = [];
        try {
          const free = await openRouterFreeModels();
          const fit = free.filter((m) => (task === 'vision' ? m.vision : task === 'stt' ? m.audio : true)).map((m) => m.id);
          const pref = s.openrouter.preferred.filter((id) => fit.includes(id));
          candidates = [...new Set([...pref, ...fit])].filter((m) => !((modelCd.get('or:' + m) ?? 0) > Date.now())).slice(0, 6);
        } catch (e) {
          errors.push('openrouter lista');
          candidates = s.openrouter.preferred.filter((id) => id.endsWith(':free'));
        }
        for (const model of candidates) {
          if (left() < 1500) break;
          try {
            const text = await openaiChat(OPENROUTER_BASE, s.openrouter.key.trim(), model, messages, opts, callMs(), {
              'HTTP-Referer': 'https://github.com/cyber-ai-desktop',
              'X-Title': 'Cyber AI',
            });
            setActive('openrouter', model);
            log('ok', 'openrouter', `${task} · ${model}`);
            return { text, provider: 'openrouter', model };
          } catch (e) {
            const err = asErr(e);
            errors.push(`openrouter: ${err.status || 'rete'}`);
            if (err.status === 401) {
              log('error', 'openrouter', 'API key non valida');
              break;
            }
            modelCd.set('or:' + model, Date.now() + (err.status === 429 ? 120_000 : 300_000));
            log('warn', 'openrouter', `${model} → ${err.message}`);
          }
        }
      }
    } catch (e) {
      // errore imprevisto in un provider: si passa al successivo
      errors.push(`${p}: ${asErr(e).message.slice(0, 60)}`);
      log('error', p, `errore imprevisto: ${asErr(e).message}`);
    }
  }

  if (task === 'vision' && !opts.noVisionRetry && left() > 5000) {
    log('warn', 'router', 'nessun modello vision disponibile, riprovo senza immagine');
    return complete('chat', textOnly(messages), { ...opts, noVisionRetry: true, deadlineMs: left() });
  }
  setActive('offline', '');
  throw new Error(errors.length ? `Nessun provider disponibile: ${errors.slice(-4).join(' | ')}` : 'Nessun provider configurato');
}

// ------------------------------------------------------------ utilità impostazioni

export async function listModels(base: string, key: string): Promise<string[]> {
  const r = await httpSafe('GET', `${base.replace(/\/+$/, '')}/models`, key ? { Authorization: `Bearer ${key}` } : {}, undefined, 15000);
  if (r.status !== 200) throw new HttpError(r.status, r.body);
  const j = safeJson(r.body);
  return ((j?.data ?? j?.models ?? []) as { id?: string; name?: string }[])
    .map((m) => String(m.id ?? m.name ?? '').replace(/^models\//, ''))
    .filter(Boolean);
}

export const listGeminiModels = (key: string) => listModels(GEMINI_BASE, key);

/** VRAM usata dai modelli caricati in Ollama (GB), null se non è Ollama. */
export async function ollamaVram(baseUrl: string): Promise<number | null> {
  const root = baseUrl.replace(/\/v1\/?$/, '');
  const r = await httpSafe('GET', `${root}/api/ps`, {}, undefined, 2000);
  if (r.status !== 200) return null;
  const j = safeJson(r.body);
  if (!j) return null;
  const bytes = (j.models ?? []).reduce((a: number, m: { size_vram?: number }) => a + (m.size_vram ?? 0), 0);
  return bytes / 1024 ** 3;
}
