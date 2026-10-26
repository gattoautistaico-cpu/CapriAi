import { useEffect, useRef, useState } from 'react';
import { clipThat, detectClipBackends } from '../lib/clip';
import { FEATURES, PRESETS, getToys, normalizeUrl, preset, runPattern, stopToys, type Toy } from '../lib/lovense';
import { uid, useApp } from '../lib/store';
import type { ClipBackend, LovensePattern, Settings as S } from '../lib/types';
import { Btn, Chip, Field, H, Select, Toggle } from './ui';

function useSet() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const patch = <K extends keyof S>(k: K, v: Partial<S[K]>) => setSettings((s) => ({ ...s, [k]: { ...(s[k] as object), ...(v as object) } }));
  return { s: settings, patch };
}

const errMsg = (e: unknown) => String(e instanceof Error ? e.message : e);

// ================================================================ CLIP

const BACKENDS: { value: ClipBackend; label: string }[] = [
  { value: 'auto', label: 'Automatico (Medal → AMD → NVIDIA → Game Bar)' },
  { value: 'medal', label: 'Medal' },
  { value: 'amd', label: 'AMD Adrenalin (Instant Replay)' },
  { value: 'nvidia', label: 'NVIDIA (ShadowPlay / NVIDIA App)' },
  { value: 'gamebar', label: 'Xbox Game Bar' },
  { value: 'custom', label: 'Tasto personalizzato' },
];

export function ClipTab() {
  const { s, patch } = useSet();
  const c = s.clip;
  const [found, setFound] = useState<ClipBackend[] | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void detectClipBackends().then(setFound);
  }, []);
  const hk = (k: keyof S['clip']['hotkeys'], v: string) => patch('clip', { hotkeys: { ...c.hotkeys, [k]: v } });
  return (
    <div className="flex flex-col gap-4">
      <section>
        <H n="20">Clip con la voce</H>
        <Toggle label="Clip attivi" hint='"Capri clip that", "Capri clippa" o <clip/> dall’AI' on={c.enabled} onChange={(v) => patch('clip', { enabled: v })} />
        <Toggle
          label="Ascolta i comandi di clip"
          hint="Microfono sempre aperto solo per le frasi di clip (whisper locale), anche senza Hey Capri"
          on={c.voice}
          onChange={(v) => patch('clip', { voice: v })}
        />
        <Toggle label="Bip di conferma" on={c.sound} onChange={(v) => patch('clip', { sound: v })} />
      </section>
      <section className="flex flex-col gap-3">
        <H n="21">Software di registrazione</H>
        <Select label="Usa" value={c.backend} onChange={(v) => patch('clip', { backend: v as ClipBackend })} options={BACKENDS} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[12px] text-muted">Rilevati:</span>
          {found === null ? <Chip tone="idle">…</Chip> : found.map((b) => <Chip key={b} tone={b === 'gamebar' ? 'idle' : 'ok'}>{b.toUpperCase()}</Chip>)}
          <Btn variant="ghost" onClick={() => void detectClipBackends().then(setFound)}>
            Aggiorna
          </Btn>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Medal" value={c.hotkeys.medal} onChange={(v) => hk('medal', v)} placeholder="F8" />
          <Field label="AMD Adrenalin" value={c.hotkeys.amd} onChange={(v) => hk('amd', v)} placeholder="Ctrl+Shift+S" />
          <Field label="NVIDIA" value={c.hotkeys.nvidia} onChange={(v) => hk('nvidia', v)} placeholder="Alt+F10" />
          <Field label="Xbox Game Bar" value={c.hotkeys.gamebar} onChange={(v) => hk('gamebar', v)} placeholder="Win+Alt+G" />
          <Field label="Personalizzato" value={c.hotkeys.custom} onChange={(v) => hk('custom', v)} placeholder="Ctrl+Alt+F12" />
        </div>
        <p className="m-0 text-[14px] text-muted">
          Devono coincidere con il tasto “salva clip / salva replay” del programma. Nel programma va attivato il replay istantaneo (AMD: Instant Replay,
          NVIDIA: Instant Replay, Medal: clip in background). Formato: Ctrl, Shift, Alt, Win + tasto, separati da +.
        </p>
      </section>
      <section className="flex flex-col gap-3">
        <H n="22">Frasi</H>
        <Field
          label="Frasi che fanno il clip (separate da virgola)"
          value={c.phrases}
          onChange={(v) => patch('clip', { phrases: v })}
          hint='Basta anche "capri" + una parola che inizia con "clip" ("capri clippa", "capri clip that").'
        />
        <Field label="Risposta dopo il clip (vuota = solo fumetto)" value={c.reply} onChange={(v) => patch('clip', { reply: v })} placeholder="Clippato, choom. Momento leggendario." />
        <div className="flex items-center gap-2">
          <Btn
            variant="primary"
            onClick={async () => {
              try {
                setMsg('OK: ' + (await clipThat()));
              } catch (e) {
                setMsg(errMsg(e));
              }
            }}
          >
            Prova clip
          </Btn>
          {msg && <span className="font-mono text-[12px] text-cyan">{msg}</span>}
        </div>
      </section>
    </div>
  );
}

// ================================================================ LOVENSE

/** Editor a barre: clic o trascinamento per impostare il livello (0-20) di ogni passo. */
function StepBars({ steps, onChange }: { steps: number[]; onChange: (s: number[]) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const setAt = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el || !steps.length) return;
    const r = el.getBoundingClientRect();
    const i = Math.max(0, Math.min(steps.length - 1, Math.floor(((clientX - r.left) / r.width) * steps.length)));
    const v = Math.max(0, Math.min(20, Math.round(((r.bottom - clientY) / r.height) * 20)));
    if (steps[i] === v) return;
    const n = [...steps];
    n[i] = v;
    onChange(n);
  };
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Passi del pattern"
      className="flex h-28 cursor-crosshair touch-none items-end gap-[2px] border border-edge bg-void/70 p-1 select-none"
      onPointerDown={(e) => {
        drag.current = true;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setAt(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => drag.current && setAt(e.clientX, e.clientY)}
      onPointerUp={() => (drag.current = false)}
      onPointerLeave={() => (drag.current = false)}
    >
      {steps.map((v, i) => (
        <div key={i} className="relative flex h-full flex-1 items-end">
          <div className="w-full bg-magenta/80 shadow-[0_0_8px_#ff2e88]" style={{ height: `${(v / 20) * 100}%`, minHeight: v ? 2 : 0 }} />
          <span className="pointer-events-none absolute top-0 left-0 w-full text-center font-mono text-[9px] text-dim">{v}</span>
        </div>
      ))}
    </div>
  );
}

function PatternCard({ p, onChange, onDelete, onTest }: { p: LovensePattern; onChange: (p: LovensePattern) => void; onDelete: () => void; onTest: () => void }) {
  const toggleFeat = (id: string) => {
    const has = p.features.includes(id);
    onChange({ ...p, features: has ? p.features.replace(id, '') : p.features + id });
  };
  return (
    <div className="flex flex-col gap-2 border border-edge bg-panel/60 p-3">
      <div className="grid grid-cols-[1fr_120px_120px] gap-2">
        <Field label="Nome" value={p.name} onChange={(v) => onChange({ ...p, name: v })} />
        <Field label="Passo (ms)" type="number" value={p.intervalMs} onChange={(v) => onChange({ ...p, intervalMs: Math.max(100, Number(v) || 100) })} />
        <Field label="Durata (s, 0 = ∞)" type="number" value={p.durationSec} onChange={(v) => onChange({ ...p, durationSec: Math.max(0, Number(v) || 0) })} />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 font-mono text-[11px] text-muted uppercase">Funzioni</span>
        <button
          type="button"
          aria-pressed={!p.features}
          onClick={() => onChange({ ...p, features: '' })}
          className={`cursor-pointer border px-2 py-1 font-mono text-[11px] ${!p.features ? 'border-yellow text-yellow' : 'border-edge text-muted'}`}
        >
          tutte
        </button>
        {FEATURES.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={p.features.includes(f.id)}
            onClick={() => toggleFeat(f.id)}
            className={`cursor-pointer border px-2 py-1 font-mono text-[11px] ${p.features.includes(f.id) ? 'border-cyan text-cyan' : 'border-edge text-muted'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <StepBars steps={p.steps} onChange={(steps) => onChange({ ...p, steps })} />
      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="ghost" disabled={p.steps.length >= 50} onClick={() => onChange({ ...p, steps: [...p.steps, p.steps[p.steps.length - 1] ?? 10] })}>
          + Passo
        </Btn>
        <Btn variant="ghost" disabled={p.steps.length <= 1} onClick={() => onChange({ ...p, steps: p.steps.slice(0, -1) })}>
          − Passo
        </Btn>
        <Btn variant="ghost" onClick={() => onChange({ ...p, steps: [...p.steps].reverse() })}>
          Inverti
        </Btn>
        <Btn variant="ghost" onClick={() => onChange({ ...p, steps: p.steps.map(() => Math.round(Math.random() * 20)) })}>
          Casuale
        </Btn>
        <Field className="min-w-[200px] flex-1" label="Livelli (0-20, separati da ;)" value={p.steps.join(';')} onChange={(v) => onChange({ ...p, steps: v.split(/[;, ]+/).filter(Boolean).slice(0, 50).map((x) => Math.max(0, Math.min(20, Number(x) || 0))) })} />
        <Btn variant="cyan" onClick={onTest}>
          ▶ Prova
        </Btn>
        <Btn variant="danger" onClick={onDelete}>
          Elimina
        </Btn>
      </div>
    </div>
  );
}

export function LovenseTab() {
  const { s, patch } = useSet();
  const l = s.lovense;
  const [toys, setToys] = useState<Toy[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok = 'OK') => {
    setMsg('');
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg(errMsg(e));
    }
  };
  const setPat = (id: string, np: LovensePattern) => patch('lovense', { patterns: l.patterns.map((x) => (x.id === id ? np : x)) });
  const patOptions = [{ value: '', label: '—' }, ...l.patterns.map((p) => ({ value: p.id, label: p.name })), ...PRESETS.map((p) => ({ value: p, label: 'preset: ' + p }))];
  return (
    <div className="flex flex-col gap-4">
      <section>
        <H n="23">Lovense</H>
        <Toggle label="Collegamento Lovense" hint="Tramite Lovense Remote (PC o telefono) in Game Mode, sulla stessa rete" on={l.enabled} onChange={(v) => patch('lovense', { enabled: v })} />
        <Toggle label="L'AI può controllarlo" hint='Tag <toy> nelle risposte, solo quando lo chiedi ("vai con Onda per 20 secondi", "stop")' on={l.aiControl} onChange={(v) => patch('lovense', { aiControl: v })} />
        <Toggle label="Collega ai mood" hint="Il mood della risposta avvia il pattern scelto qui sotto" on={l.moodLink} onChange={(v) => patch('lovense', { moodLink: v })} />
      </section>

      <section className="flex flex-col gap-3">
        <H n="24">Connessione</H>
        <Field
          label="Indirizzo Lovense Remote"
          value={l.url}
          onChange={(v) => patch('lovense', { url: v })}
          hint={`Lovense Remote → Discover → Game Mode → attiva LAN e copia IP e porta (es. 192.168.1.44:30010). Remote per PC: 127-0-0-1.lovense.club:30010. Uso: ${normalizeUrl(l.url)}`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Btn
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg('');
              try {
                const t = await getToys();
                setToys(t);
                setMsg(t.length ? `${t.length} giocattoli` : 'nessun giocattolo connesso alla Remote');
              } catch (e) {
                setToys(null);
                setMsg(errMsg(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? '…' : 'Cerca giocattoli'}
          </Btn>
          <Btn variant="danger" onClick={() => void run(stopToys, 'STOP')}>
            ■ STOP
          </Btn>
          {msg && <span className="font-mono text-[12px] text-cyan">{msg}</span>}
        </div>
        {toys && toys.length > 0 && (
          <Select
            label="Giocattolo"
            value={l.toy}
            onChange={(v) => patch('lovense', { toy: v })}
            options={[{ value: '', label: 'Tutti' }, ...toys.map((t) => ({ value: t.id, label: `${t.nickName || t.name} · ${t.battery >= 0 ? t.battery + '%' : ''} · ${t.functions}` }))]}
          />
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="lv-max" className="font-mono text-[11px] tracking-[1px] text-muted uppercase">
            Intensità massima: {l.maxLevel}/20
          </label>
          <input id="lv-max" type="range" min={0} max={20} value={l.maxLevel} onChange={(e) => patch('lovense', { maxLevel: Number(e.target.value) })} className="accent-[#ff2e88]" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <H n="25">Preset Lovense</H>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Btn key={p} variant="ghost" onClick={() => void run(() => preset(p, 8), p)}>
              ▶ {p}
            </Btn>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <H n="26">Pattern ({l.patterns.length})</H>
        {l.patterns.map((p) => (
          <PatternCard
            key={p.id}
            p={p}
            onChange={(np) => setPat(p.id, np)}
            onDelete={() => patch('lovense', { patterns: l.patterns.filter((x) => x.id !== p.id) })}
            onTest={() => void run(() => runPattern(p, Math.min(p.durationSec || 8, 15)), p.name)}
          />
        ))}
        <Btn
          variant="outline"
          onClick={() => patch('lovense', { patterns: [...l.patterns, { id: uid(), name: 'Nuovo pattern', features: 'v', intervalMs: 300, steps: [5, 10, 15, 20, 15, 10], durationSec: 10 }] })}
        >
          + Nuovo pattern
        </Btn>
      </section>

      <section className="flex flex-col gap-3">
        <H n="27">Mood → pattern</H>
        <div className="grid grid-cols-3 gap-3">
          {['happy', 'love', 'smug', 'surprised', 'angry', 'sad'].map((m) => (
            <Select key={m} label={m} value={l.moodMap[m] ?? ''} onChange={(v) => patch('lovense', { moodMap: { ...l.moodMap, [m]: v } })} options={patOptions} />
          ))}
        </div>
        <Field label="Durata per mood (s)" type="number" value={l.moodSec} onChange={(v) => patch('lovense', { moodSec: Math.max(1, Number(v) || 6) })} />
      </section>
    </div>
  );
}
