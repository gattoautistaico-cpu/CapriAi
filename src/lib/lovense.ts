/**
 * Lovense: controllo dei giocattoli tramite la Lovense Remote (Game Mode / Standard API locale).
 * È lo stesso canale usato dai plugin per game engine "for Remote" (Unity, Unreal, Ren'Py):
 * POST https://{ip-con-trattini}.lovense.club:{porta}/command con JSON.
 * Doc: https://developer.lovense.com/docs/standard-solutions/standard-api.html
 */
import { fetch as tfetch } from '@tauri-apps/plugin-http';
import { log, useApp } from './store';
import type { LovensePattern } from './types';

export const PRESETS = ['pulse', 'wave', 'fireworks', 'earthquake'] as const;
export const FEATURES: { id: string; label: string; action: string; max: number }[] = [
  { id: 'v', label: 'Vibrate', action: 'Vibrate', max: 20 },
  { id: 'r', label: 'Rotate', action: 'Rotate', max: 20 },
  { id: 'p', label: 'Pump', action: 'Pump', max: 3 },
  { id: 't', label: 'Thrust', action: 'Thrusting', max: 20 },
  { id: 'f', label: 'Fingering', action: 'Fingering', max: 20 },
  { id: 's', label: 'Suction', action: 'Suction', max: 20 },
  { id: 'd', label: 'Depth', action: 'Depth', max: 3 },
  { id: 'o', label: 'Oscillate', action: 'Oscillate', max: 20 },
];

export interface Toy {
  id: string;
  name: string;
  nickName: string;
  battery: number;
  status: string;
  functions: string;
}

/**
 * Normalizza ciò che l'utente incolla: URL completo, "192.168.1.44:20010",
 * "192.168.1.44" (→ https porta 30010) oppure l'host lovense.club.
 */
export function normalizeUrl(input: string): string {
  const v = (input || '').trim().replace(/\/+$/, '').replace(/\/command$/, '');
  if (/^https?:\/\//i.test(v)) return v;
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?$/.exec(v);
  if (m) {
    const port = m[2] ? Number(m[2]) : 30010;
    // 20010 = http in chiaro, 30010 = https con il dominio lovense.club
    if (port === 20010 || (port !== 30010 && port < 30000)) return `http://${m[1]}:${port}`;
    return `https://${m[1].replace(/\./g, '-')}.lovense.club:${port}`;
  }
  if (/lovense\.club/i.test(v)) return 'https://' + v;
  return v;
}

async function command(body: Record<string, unknown>, timeoutMs = 6000): Promise<any> {
  const l = useApp.getState().settings.lovense;
  const url = normalizeUrl(l.url) + '/command';
  const ctrl = new AbortController();
  const t = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await tfetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-platform': 'Capri AI' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      connectTimeout: Math.min(timeoutMs, 4000),
    });
    const txt = await res.text();
    let j: any = null;
    try {
      j = JSON.parse(txt);
    } catch {
      /* risposta non JSON */
    }
    if (!res.ok || !j || (j.code && j.code !== 200)) {
      const code = j?.code ?? res.status;
      const why: Record<number, string> = {
        400: 'comando non valido',
        401: 'giocattolo non trovato',
        402: 'giocattolo non connesso',
        403: 'il giocattolo non supporta questo comando',
        404: 'parametro non valido',
        500: 'server HTTP della Remote non attivo (abilita Game Mode)',
        506: 'errore della Remote: riavviala',
      };
      throw new Error(`Lovense ${code}: ${why[code] ?? txt.slice(0, 120)}`);
    }
    return j;
  } finally {
    window.clearTimeout(t);
  }
}

const toyField = () => {
  const id = useApp.getState().settings.lovense.toy;
  return id ? { toy: id } : {};
};

/** Applica il limite d'intensità (0-20) a un livello nella scala nativa della funzione (0..max). */
function cap(level: number, max = 20): number {
  const lim = Math.max(0, Math.min(20, useApp.getState().settings.lovense.maxLevel ?? 20));
  const v = Math.max(0, Math.min(max, Number(level) || 0));
  return Math.round((v * lim) / 20);
}

export async function getToys(): Promise<Toy[]> {
  const j = await command({ command: 'GetToys' });
  let raw = j?.data?.toys ?? {};
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = {};
    }
  }
  return Object.values(raw as Record<string, any>).map((t) => ({
    id: String(t.id ?? ''),
    name: String(t.name ?? ''),
    nickName: String(t.nickName ?? ''),
    battery: Number(t.battery ?? -1),
    status: String(t.status ?? ''),
    functions: String(t.fullFunctionNames ?? t.shortFunctionNames ?? ''),
  }));
}

/** Livelli diretti, es. { v: 12, r: 5 } per `sec` secondi (0 = finché non si ferma). */
export async function func(levels: Record<string, number>, sec: number, loop?: { run: number; pause: number }) {
  const parts = Object.entries(levels)
    .map(([k, v]) => {
      if (k.toLowerCase() === 'all') return `All:${cap(v)}`;
      const f = FEATURES.find((x) => x.id === k || x.action.toLowerCase() === k.toLowerCase());
      return f ? `${f.action}:${cap(v, f.max)}` : '';
    })
    .filter(Boolean);
  if (!parts.length) throw new Error('nessuna funzione');
  const body: Record<string, unknown> = { command: 'Function', action: parts.join(','), timeSec: Math.max(0, sec), apiVer: 1, stopPrevious: 1, ...toyField() };
  if (sec !== 0 && sec < 1) body.timeSec = 1;
  if (loop && loop.run > 1 && loop.pause > 1) {
    body.loopRunningSec = loop.run;
    body.loopPauseSec = loop.pause;
  }
  await command(body);
  log('ok', 'lovense', `${body.action} · ${body.timeSec}s`);
}

export async function stopToys() {
  await command({ command: 'Function', action: 'Stop', timeSec: 0, apiVer: 1, ...toyField() });
  log('ok', 'lovense', 'stop');
}

export async function preset(name: string, sec: number) {
  const n = PRESETS.find((p) => p === name.toLowerCase()) ?? 'pulse';
  await command({ command: 'Preset', name: n, timeSec: Math.max(0, sec), apiVer: 1, ...toyField() });
  log('ok', 'lovense', `preset ${n} · ${sec}s`);
}

export async function runPattern(p: LovensePattern, sec?: number) {
  const steps = (p.steps.length ? p.steps : [10]).slice(0, 50).map((x) => cap(x));
  const feats = p.features.replace(/[^vrptfsdo]/g, '').split('').join(',');
  const s = sec ?? p.durationSec;
  await command({
    command: 'Pattern',
    rule: `V:1;F:${feats};S:${Math.max(100, Math.round(p.intervalMs))}#`,
    strength: steps.join(';'),
    timeSec: Math.max(0, s),
    apiVer: 2,
    ...toyField(),
  });
  log('ok', 'lovense', `pattern ${p.name} · ${s}s`);
}

export function findPattern(name: string): LovensePattern | undefined {
  const n = name.trim().toLowerCase();
  const ps = useApp.getState().settings.lovense.patterns;
  return ps.find((p) => p.id === n || p.name.toLowerCase() === n) ?? ps.find((p) => p.name.toLowerCase().includes(n));
}

/** Comando arrivato da un tag dell'AI: <toy pattern="Onda" sec="10"/>, <toy v="12" sec="5"/>, <toy preset="pulse"/>, <toy stop/>. */
export interface ToyCmd {
  stop?: boolean;
  pattern?: string;
  preset?: string;
  levels?: Record<string, number>;
  sec?: number;
}

export function parseToyTags(text: string, out: ToyCmd[]): string {
  return text.replace(/<toy\b([^>]*?)\/?>(?:\s*<\/toy>)?/gi, (_, attrs: string) => {
    const a: Record<string, string> = {};
    attrs.replace(/(\w+)\s*(?:=\s*"([^"]*)"|=\s*'([^']*)'|=\s*([^\s"']+))?/g, (_m: string, k: string, v1?: string, v2?: string, v3?: string) => {
      a[k.toLowerCase()] = v1 ?? v2 ?? v3 ?? 'true';
      return '';
    });
    const sec = a.sec !== undefined ? Number(a.sec) : undefined;
    if ('stop' in a) out.push({ stop: true });
    else if (a.pattern) out.push({ pattern: a.pattern, sec });
    else if (a.preset) out.push({ preset: a.preset, sec });
    else {
      const levels: Record<string, number> = {};
      for (const f of FEATURES) if (a[f.id] !== undefined) levels[f.id] = Number(a[f.id]) || 0;
      if (a.all !== undefined) levels.all = Number(a.all) || 0;
      if (Object.keys(levels).length) out.push({ levels, sec });
    }
    return '';
  });
}

export async function runToyCmds(cmds: ToyCmd[]) {
  const l = useApp.getState().settings.lovense;
  if (!l.enabled) return;
  for (const c of cmds) {
    try {
      if (c.stop) await stopToys();
      else if (c.pattern) {
        const p = findPattern(c.pattern);
        if (p) await runPattern(p, c.sec);
        else if (PRESETS.includes(c.pattern.toLowerCase() as never)) await preset(c.pattern, c.sec ?? 10);
        else log('warn', 'lovense', `pattern sconosciuto: ${c.pattern}`);
      } else if (c.preset) await preset(c.preset, c.sec ?? 10);
      else if (c.levels) await func(c.levels, c.sec ?? 10);
    } catch (e) {
      log('error', 'lovense', String(e instanceof Error ? e.message : e));
    }
  }
}

/** Mood della risposta → pattern associato (se il collegamento è attivo). */
export async function moodToy(mood: string) {
  const l = useApp.getState().settings.lovense;
  if (!l.enabled || !l.moodLink) return;
  const name = l.moodMap[mood];
  if (!name) return;
  const p = findPattern(name);
  try {
    if (p) await runPattern(p, l.moodSec);
    else if (PRESETS.includes(name as never)) await preset(name, l.moodSec);
  } catch (e) {
    log('warn', 'lovense', String(e instanceof Error ? e.message : e));
  }
}

export function toyPrompt(): string {
  const l = useApp.getState().settings.lovense;
  if (!l.enabled || !l.aiControl) return '';
  const names = l.patterns.map((p) => `"${p.name}"`).join(', ');
  return [
    "L'utente ha collegato un dispositivo Lovense e ti permette di controllarlo con tag nascosti, SOLO quando te lo chiede esplicitamente o il contesto lo richiede chiaramente:",
    `<toy pattern="nome" sec="10"/> avvia un pattern (disponibili: ${names}; preset: pulse, wave, fireworks, earthquake).`,
    '<toy v="0-20" sec="5"/> vibrazione diretta (anche r= rotate, p= pump 0-3, t= thrust, s= suction, all=).',
    '<toy stop/> ferma tutto. Se l\'utente dice stop/basta/ferma, usa sempre <toy stop/>.',
  ].join('\n');
}
