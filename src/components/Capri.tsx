/**
 * MODALITÀ CAPRI
 * - Sigillo compatto "NOME // DORMANT" quando inattiva; click = ascolta.
 * - Si apre con transizione glitch (sigillo -> linea -> rumore RGB -> finestra).
 * - Finestra con bordo a doppia linea + angolari, colore per stato:
 *   LISTENING cyan, THINKING/TALKING giallo, ONLINE rosso, DORMANT viola.
 * - Terminale a fumetto: "> you: …", "// now playing: …", "NOME >", testo a macchina
 *   da scrivere con cursore a blocco, "decrypting ▮▯▯" mentre pensa, input "YOU >".
 * - Torna dormiente dopo N secondi di inattività (glitch di chiusura).
 */
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ask } from '../lib/brain';
import { say } from '../lib/commands';
import { setInteractive, useHitRef } from '../lib/hit';
import { T } from '../lib/i18n';
import { log, useApp } from '../lib/store';
import { mic } from '../lib/stt';
import { getVoiceLevel } from '../lib/tts';
import { useSpriteFrame } from '../lib/useSprite';
import { SpriteMedia } from './SpriteMedia';
import { EyeBurst, Lightning, Sparks } from './CapriFx';
import { CapriMenu } from './CapriMenu';

type CState = 'dormant' | 'listening' | 'thinking' | 'talking' | 'online' | 'dj mode' | 'search mode' | 'clipped' | 'rewiring';
type Phase = 'sigil' | 'opening' | 'frame' | 'closing';

// colori come nel video: TALKING/ONLINE rosso, THINKING giallo, DJ/SEARCH/CLIPPED verde, REWIRING bianco-cyan
const COLOR: Record<CState, string> = {
  dormant: '#9b6bff',
  listening: '#00f0ff',
  thinking: '#fcee0a',
  talking: '#ff1f4b',
  online: '#ff1f4b',
  'dj mode': '#2bff88',
  'search mode': '#2bff88',
  clipped: '#2bff88',
  rewiring: '#d8f6ff',
};
const MONO = "'Share Tech Mono', 'Cascadia Mono', Consolas, monospace";

// ------------------------------------------------------------ effetti

/** Raffica di rumore glitch: barre orizzontali RGB su canvas. */
function GlitchBurst({ ms = 420, className = '' }: { ms?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = (c.width = c.offsetWidth || 300);
    const h = (c.height = c.offsetHeight || 180);
    const palette = ['#ff1f4b', '#2bff88', '#00f0ff', '#0a0a0f', '#ffffff', '#ff2e88'];
    const t0 = performance.now();
    let raf = 0;
    const draw = (t: number) => {
      const p = (t - t0) / ms;
      ctx.clearRect(0, 0, w, h);
      if (p >= 1) return;
      const n = 18 + Math.floor(Math.random() * 18);
      for (let i = 0; i < n; i++) {
        const y = Math.random() * h;
        const bh = 1 + Math.random() * (h / 14);
        const x = Math.random() * w * 0.3;
        const bw = w * (0.35 + Math.random() * 0.7);
        ctx.globalAlpha = 0.45 + Math.random() * 0.55;
        ctx.fillStyle = palette[(Math.random() * palette.length) | 0];
        ctx.fillRect(x, y, bw, bh);
        // grana
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = palette[(Math.random() * 3) | 0];
          ctx.fillRect(x + Math.random() * bw, y, 2 + Math.random() * 6, bh);
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [ms]);
  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />;
}

/** Barre di livello accanto all'etichetta (mic quando ascolta, voce quando parla). */
function LevelBars({ mode, color }: { mode: 'mic' | 'voice' | 'idle'; color: string }) {
  const [lv, setLv] = useState<number[]>(Array(8).fill(0));
  useEffect(() => {
    if (mode === 'idle') {
      setLv(Array(8).fill(0));
      return;
    }
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 70) {
        last = t;
        const base = mode === 'mic' ? Math.min(1, mic.level * 9) : getVoiceLevel();
        setLv(Array.from({ length: 8 }, () => Math.max(0.12, Math.min(1, base * (0.4 + Math.random() * 0.9)))));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode]);
  return (
    <span className="ml-1 flex h-[14px] items-end gap-[2px]" aria-hidden="true">
      {lv.map((v, i) =>
        mode === 'idle' ? (
          <span key={i} className="mb-[6px] block h-[2px] w-[3px]" style={{ background: color, opacity: 0.8 }} />
        ) : (
          <span key={i} className="block w-[3px]" style={{ height: `${Math.round(v * 14)}px`, background: color }} />
        ),
      )}
    </span>
  );
}

function Tag({ name, state, bars, onPointerDown }: { name: string; state: CState; bars: 'mic' | 'voice' | 'idle' | null; onPointerDown?: (e: React.PointerEvent) => void }) {
  const c = COLOR[state];
  return (
    <div className="flex cursor-move items-center select-none" onPointerDown={onPointerDown} title="Trascina per spostare">
      <span
        className="flex items-center gap-[5px] border px-[6px] py-[1px] text-[11px] font-bold tracking-[1px] whitespace-nowrap"
        style={{ fontFamily: MONO, color: c, borderColor: c, background: 'rgba(8,8,14,0.94)', boxShadow: `0 0 8px ${c}55` }}
      >
        {state !== 'rewiring' && <span className="block h-[5px] w-[5px]" style={{ background: c }} aria-hidden="true" />}
        {name.toUpperCase()} // {state.toUpperCase()}
      </span>
      {bars && (
        <span className="ml-[3px] flex h-[16px] items-center border px-[3px]" style={{ borderColor: `${c}66`, background: 'rgba(8,8,14,0.85)' }}>
          <LevelBars mode={bars} color={c} />
        </span>
      )}
    </div>
  );
}

/** Sigillo di default (originale) quando non c'è uno sprite "dormant". */
function DefaultSigil({ color }: { color: string }) {
  return (
    <motion.svg
      width="72"
      height="72"
      viewBox="0 0 72 72"
      aria-hidden="true"
      animate={{ rotate: 360 }}
      transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
    >
      <circle cx="36" cy="36" r="30" fill="none" stroke={color} strokeWidth="2" strokeDasharray="6 5" opacity="0.8" />
      <circle cx="36" cy="36" r="20" fill="none" stroke="#ff2e88" strokeWidth="1.5" strokeDasharray="2 4" />
      <path d="M36 22 L48 36 L36 50 L24 36 Z" fill="#0a0a0f" stroke={color} strokeWidth="2" />
      <circle cx="36" cy="36" r="5" fill={color} />
      <circle cx="37.5" cy="34.5" r="1.6" fill="#fff" />
    </motion.svg>
  );
}

// ------------------------------------------------------------ typewriter

function useTypewriter(text: string, cps: number, key: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return;
    const step = Math.max(10, 1000 / Math.max(5, cps));
    const t = window.setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          window.clearInterval(t);
          return v;
        }
        return v + 1;
      });
    }, step);
    return () => window.clearInterval(t);
  }, [text, cps, key]);
  return { shown: text.slice(0, n), typing: n < text.length };
}

function Decrypting() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((v) => (v + 1) % 4), 220);
    return () => window.clearInterval(t);
  }, []);
  return <span>decrypting {'▮'.repeat(Math.min(3, i + 1)).padEnd(3, '▯')}</span>;
}

// ------------------------------------------------------------ terminale

function downscale(file: File, max: number): Promise<string> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / img.width);
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k);
      cv.height = Math.round(img.height * k);
      cv.getContext('2d')?.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      res(cv.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => res('');
    img.src = URL.createObjectURL(file);
  });
}

function Terminal({ name, width, busy }: { name: string; width: number; busy: boolean }) {
  const ref = useHitRef('capri-bubble');
  const balloon = useApp((s) => s.balloon);
  const ex = useApp((s) => s.exchange);
  const thinking = useApp((s) => s.status.thinking);
  const cps = useApp((s) => s.settings.capri.typeCps);
  const { shown, typing } = useTypewriter(balloon?.text ?? '', cps, balloon?.ts ?? 0);
  const [text, setText] = useState('');
  const [cursorOn, setCursorOn] = useState(true);
  useEffect(() => {
    const t = window.setInterval(() => setCursorOn((v) => !v), 480);
    return () => window.clearInterval(t);
  }, []);

  const replyFresh = !!balloon && balloon.ts >= ex.ts - 50;
  const showReply = !thinking && replyFresh;

  return (
    <div
      ref={ref}
      className="absolute"
      style={{ bottom: 'calc(100% + 26px)', left: -Math.round(width * 0.16), width: Math.round(width * 1.12) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* bordo cyan con angoli tagliati */}
      <div
        style={{
          background: '#00f0ff',
          padding: 2,
          clipPath: 'polygon(14px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 14px)',
          filter: 'drop-shadow(0 0 6px rgba(0,240,255,0.55))',
        }}
      >
        <div
          className="px-3 pt-2 pb-2"
          style={{
            background: 'rgba(11,12,18,0.96)',
            fontFamily: MONO,
            clipPath: 'polygon(13px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 13px)',
          }}
        >
          {ex.user && <div className="truncate text-[12px] italic text-[#8a8f9c]">&gt; you: {ex.user}</div>}
          {ex.np && <div className="truncate text-[12px] italic text-[#8a8f9c]">{`// now playing: ${ex.np}`}</div>}
          {ex.sys && <div className="truncate text-[12px] italic text-[#8a8f9c]">{`// ${ex.sys}`}</div>}
          {(thinking || replyFresh || !ex.user) && (
            <div className="mt-1 border-l-[3px] border-[#ff1f4b] pl-2">
              <div className="text-[12px] font-bold text-[#fcee0a]">{name.toUpperCase()} &gt;</div>
              <div className="min-h-[20px] text-[15px] leading-snug whitespace-pre-wrap text-[#f2f0e6]">
                {thinking ? (
                  <Decrypting />
                ) : showReply ? (
                  <>
                    {shown}
                    {(typing || busy) && (
                      <span className="ml-[1px] inline-block h-[15px] w-[8px] translate-y-[2px] bg-[#f2f0e6]" style={{ opacity: cursorOn || typing ? 1 : 0 }} />
                    )}
                  </>
                ) : (
                  <span className="text-[#8a8f9c]">online. dimmi tutto, choom.</span>
                )}
              </div>
            </div>
          )}
          <form
            className="mt-2 flex items-center gap-2 border-t border-dashed border-[#00f0ff]/50 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              const t = text.trim();
              if (!t) return;
              setText('');
              void ask(t);
            }}
          >
            <label htmlFor="capri-in" className="text-[12px] font-bold text-[#00f0ff]">
              YOU &gt;
            </label>
            <input
              id="capri-in"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="say something..."
              autoComplete="off"
              className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-[#f2f0e6] outline-none placeholder:text-[#6d7280]"
              style={{ fontFamily: MONO }}
            />
            <label className="cursor-pointer px-1 text-[10px] text-[#00f0ff]/40 hover:text-[#00f0ff]" title="Invia un'immagine">
              IMG
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  const img = await downscale(f, 1024);
                  const t = text.trim();
                  setText('');
                  void ask(t, { image: img });
                }}
              />
            </label>
          </form>
        </div>
      </div>
      {/* coda del fumetto */}
      <div
        aria-hidden="true"
        className="absolute"
        style={{ right: Math.round(width * 0.2), bottom: -16, width: 26, height: 18, background: '#00f0ff', clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }}
      >
        <div className="absolute" style={{ left: 3, top: 0, width: 21, height: 14, background: 'rgba(11,12,18,0.96)', clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ finestra

function Corner({ pos, color }: { pos: 'tl' | 'tr' | 'bl' | 'br'; color: string }) {
  const s: React.CSSProperties = { position: 'absolute', width: 18, height: 18, borderColor: color, borderStyle: 'solid', borderWidth: 0 };
  if (pos[0] === 't') s.top = -5;
  else s.bottom = -5;
  if (pos[1] === 'l') s.left = -5;
  else s.right = -5;
  if (pos === 'tl') Object.assign(s, { borderTopWidth: 4, borderLeftWidth: 4 });
  if (pos === 'tr') Object.assign(s, { borderTopWidth: 4, borderRightWidth: 4 });
  if (pos === 'bl') Object.assign(s, { borderBottomWidth: 4, borderLeftWidth: 4 });
  if (pos === 'br') Object.assign(s, { borderBottomWidth: 4, borderRightWidth: 4 });
  return <span aria-hidden="true" style={s} />;
}

function SearchBox({ color }: { color: string }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = window.setInterval(() => setOn((v) => !v), 480);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div
      className="absolute right-[10px] -top-[11px] flex h-[18px] items-center gap-1 border px-2 text-[10px]"
      style={{ borderColor: color, color, background: 'rgba(5,10,8,0.95)', fontFamily: MONO, boxShadow: `0 0 8px ${color}55` }}
      aria-hidden="true"
    >
      search
      <span style={{ opacity: on ? 1 : 0 }}>▌</span>
      <span className="ml-2">⌕</span>
    </div>
  );
}

function FrameView({ width, state, frame, name, anyFrames, glitchOn }: { width: number; state: CState; frame?: string; name: string; anyFrames: boolean; glitchOn: boolean }) {
  const c = COLOR[state];
  const setPanel = useApp((s) => s.setPanel);
  const [burst, setBurst] = useState(0);
  // glitch casuale a riposo + a ogni cambio stato
  useEffect(() => {
    if (!glitchOn) return;
    setBurst((b) => b + 1);
  }, [state, glitchOn]);
  useEffect(() => {
    if (!glitchOn) return;
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        setBurst((b) => b + 1);
        loop();
      }, 5000 + Math.random() * 9000);
    };
    loop();
    return () => window.clearTimeout(t);
  }, [glitchOn]);

  return (
    <motion.div
      key={state}
      className="absolute inset-0"
      initial={{ opacity: 0.4 }}
      animate={{ opacity: [0.4, 1, 0.7, 1] }}
      transition={{ duration: 0.35, times: [0, 0.3, 0.6, 1] }}
      style={{ border: `2px solid ${c}`, boxShadow: `0 0 14px ${c}66, inset 0 0 10px ${c}33`, background: '#07070c' }}
    >
      <div className="absolute inset-[4px] overflow-hidden" style={{ border: `1px solid ${c}99` }}>
        {state === 'rewiring' ? (
          <div className="h-full w-full" style={{ background: 'linear-gradient(180deg, #050812, #0b1630)' }} />
        ) : anyFrames && frame ? (
          <SpriteMedia path={frame} alt={`Avatar ${name}`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center" style={{ fontFamily: MONO }}>
            <div className="text-[16px] tracking-[3px]" style={{ color: c }}>
              NO SIGNAL
            </div>
            <div className="text-[12px] text-[#a9a3bd]">importa sprite, GIF o clip video (webm/mp4)</div>
            <button
              type="button"
              onClick={() => setPanel('settings', 'avatar')}
              className="mt-1 cursor-pointer border px-3 py-1 text-[12px]"
              style={{ borderColor: c, color: c, fontFamily: MONO }}
            >
              + IMPORTA
            </button>
          </div>
        )}
        {/* scanlines + vignetta */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.28) 3px)',
            boxShadow: 'inset 0 0 40px rgba(0,0,0,0.6)',
          }}
        />
        {glitchOn && burst > 0 && <GlitchBurst key={burst} ms={220} className="mix-blend-screen" />}
        {state === 'rewiring' && <GlitchBurst ms={900} />}
        <div className="pointer-events-none absolute top-[3px] left-[6px] text-[8px] tracking-[1px]" style={{ fontFamily: MONO, color: '#c8c3d8aa' }} aria-hidden="true">
          NC//NET&nbsp;&nbsp;CH.06
        </div>
      </div>
      {state === 'search mode' && <SearchBox color={c} />}
      {state === 'thinking' ? (
        <>
          <Corner pos="tl" color={c} />
          <Corner pos="tr" color={c} />
          <Corner pos="bl" color={c} />
          <Corner pos="br" color={c} />
        </>
      ) : (
        (['tl', 'tr', 'bl', 'br'] as const).map((p) => (
          <span
            key={p}
            aria-hidden="true"
            className="absolute h-[6px] w-[6px]"
            style={{ background: c, top: p[0] === 't' ? -3 : undefined, bottom: p[0] === 'b' ? -3 : undefined, left: p[1] === 'l' ? -3 : undefined, right: p[1] === 'r' ? -3 : undefined }}
          />
        ))
      )}
    </motion.div>
  );
}

// ------------------------------------------------------------ root

interface ExtWin {
  hwnd: number;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function CapriOverlay({ onListen }: { onListen: () => void }) {
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.settings.activeProfileId) ?? s.profiles[0]);
  const status = useApp((s) => s.status);
  const balloon = useApp((s) => s.balloon);
  const exchangeTs = useApp((s) => s.exchange.ts);
  const capri = useApp((s) => s.settings.capri);
  const capriMode = useApp((s) => s.capriMode);
  const fx = useApp((s) => s.capriFx);
  const replaySec = useApp((s) => s.settings.replay.seconds);
  const setSettings = useApp((s) => s.setSettings);
  const updateProfile = useApp((s) => s.updateProfile);
  const sigilRef = useHitRef('capri-sigil');
  const frameRef = useHitRef('capri-frame');

  const W = capri.frameWidth;
  const H = Math.round(W * 0.58);
  const name = profile?.name ?? 'Capri';

  const [awake, setAwake] = useState(false);
  const [phase, setPhase] = useState<Phase>('sigil');
  const lastActive = useRef(Date.now());
  const busy = status.listening || status.thinking || status.speaking;

  // ---- effetti a tempo (REWIRING ~0.7 s, CLIPPED ~2.6 s)
  const [fxKind, setFxKind] = useState<'rewiring' | 'clipped' | null>(null);
  useEffect(() => {
    if (!fx) return;
    setFxKind(fx.kind);
    const t = window.setTimeout(() => setFxKind(null), fx.kind === 'clipped' ? 2600 : 700);
    return () => window.clearTimeout(t);
  }, [fx?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- stato visivo
  const base: CState = status.listening
    ? 'listening'
    : status.thinking
      ? 'thinking'
      : status.speaking
        ? 'talking'
        : awake || phase !== 'sigil'
          ? 'online'
          : 'dormant';
  const cstate: CState =
    fxKind === 'rewiring'
      ? 'rewiring'
      : fxKind === 'clipped'
        ? 'clipped'
        : base === 'online' && capriMode === 'dj'
          ? 'dj mode'
          : base === 'online' && capriMode === 'search'
            ? 'search mode'
            : base;
  const modeSprite = fxKind === 'clipped' ? 'clipped' : !status.speaking && !status.thinking && capriMode !== 'normal' ? (capriMode === 'dj' ? 'dj' : 'search') : undefined;
  const forced = phase === 'sigil' ? (base === 'dormant' ? 'dormant' : undefined) : modeSprite;
  const { frame, anyFrames, has } = useSpriteFrame(profile, forced);

  // ---- posizione (in basso a destra di default)
  const layout = profile?.layout;
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const posRef = useRef(pos);
  posRef.current = pos;
  const clamp = (x: number, y: number) => ({
    x: Math.max(8, Math.min(window.innerWidth - W - 8, x)),
    y: Math.max(200, Math.min(window.innerHeight - H - 8, y)),
  });
  useEffect(() => {
    if (!layout || capri.clingy) return;
    const x = layout.x < 0 ? window.innerWidth - W - 70 : layout.x;
    const y = layout.y < 0 ? window.innerHeight - H - 90 : layout.y;
    setPos(clamp(x, y));
  }, [profile?.id, layout?.x, layout?.y, W]); // eslint-disable-line react-hooks/exhaustive-deps
  const savePos = (p: { x: number; y: number }) => {
    if (profile) updateProfile(profile.id, (pr) => ({ ...pr, layout: { ...pr.layout, x: Math.round(p.x), y: Math.round(p.y) } }));
  };

  // ---- drag NORMAL (dall'etichetta) e LIGHTNING (lazo a fulmine, poi salto)
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  const [lasso, setLasso] = useState<{ x: number; y: number } | null>(null);
  const [jump, setJump] = useState<'out' | 'in' | null>(null);
  const [spark, setSpark] = useState<{ x: number; y: number; k: number } | null>(null);

  const onDragStart = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (capri.clingy) setSettings((s) => ({ ...s, capri: { ...s.capri, clingy: false } }));
    if (capri.dragMode === 'lightning') {
      // tutta la finestra intercetta il mouse finché si trascina il fulmine
      setInteractive(true);
      setLasso({ x: e.clientX, y: e.clientY });
      useApp.getState().showBalloon(T('Trascinami e salto lì.'), 'happy');
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.moved = true;
    setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
  };
  const onDragEnd = () => {
    if (drag.current?.moved) savePos(pos);
    drag.current = null;
  };

  // movimento e rilascio del fulmine (sulla finestra intera)
  useEffect(() => {
    if (!lasso) return;
    const move = (e: PointerEvent) => setLasso({ x: e.clientX, y: e.clientY });
    const up = (e: PointerEvent) => {
      setLasso(null);
      setInteractive(useApp.getState().lockInteractive);
      const p0 = posRef.current;
      const far = Math.hypot(e.clientX - (p0.x + W / 2), e.clientY - (p0.y + H / 2)) > 40;
      if (!far) return;
      // salto: glitch fuori → scintille → glitch dentro nel punto indicato
      const target = clamp(e.clientX - W / 2, e.clientY - H / 2);
      setSpark({ x: e.clientX, y: e.clientY, k: Date.now() });
      setJump('out');
      window.setTimeout(() => {
        setPos(target);
        savePos(target);
        setJump('in');
        window.setTimeout(() => setJump(null), 380);
      }, capri.glitch ? 260 : 10);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [!!lasso]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- CLINGY MODE: si attacca alla finestra in primo piano e la segue
  const lastExt = useRef<ExtWin | null>(null);
  const [flash, setFlash] = useState<ExtWin | null>(null);
  useEffect(() => {
    const t = window.setInterval(async () => {
      const w = await invoke<ExtWin | null>('foreground_window').catch(() => null);
      if (w && w.w > 120 && w.h > 80) lastExt.current = w;
    }, 500);
    return () => window.clearInterval(t);
  }, []);
  const clingTo = useRef<number>(0);
  const setClingy = (on: boolean) => {
    if (on) {
      const w = lastExt.current;
      if (!w) {
        say(T('Non vedo nessuna finestra a cui attaccarmi.'), 'sad');
        return;
      }
      clingTo.current = w.hwnd;
      setFlash(w);
      window.setTimeout(() => setFlash(null), 650);
      setSettings((s) => ({ ...s, capri: { ...s.capri, clingy: true } }));
      say(T('Finalmente! Adesso sei mio, niente ripensamenti.'), 'love');
      log('info', 'capri', `clingy: ${w.title}`);
    } else {
      clingTo.current = 0;
      setSettings((s) => ({ ...s, capri: { ...s.capri, clingy: false } }));
      say(T('Va bene, ti lascio respirare.'), 'smug');
    }
  };
  useEffect(() => {
    if (!capri.clingy) return;
    if (!clingTo.current && lastExt.current) clingTo.current = lastExt.current.hwnd;
    const t = window.setInterval(async () => {
      if (!clingTo.current || drag.current) return;
      const r = await invoke<ExtWin | null>('window_rect', { hwnd: clingTo.current }).catch(() => null);
      if (!r) return;
      // sul bordo destro della finestra, in alto (come nel video)
      const p = clamp(r.x + r.w - W * 0.38, r.y + Math.min(150, r.h * 0.18));
      const c = posRef.current;
      if (Math.abs(p.x - c.x) > 1 || Math.abs(p.y - c.y) > 1) setPos(p);
    }, 90);
    return () => window.clearInterval(t);
  }, [capri.clingy, W]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- menu CAPRI (tasto destro)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX + 4, y: e.clientY - 20 });
  };

  // ---- transizioni
  const timers = useRef<number[]>([]);
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  const open = () => {
    if (phase === 'frame' || phase === 'opening') return;
    clearTimers();
    setPhase('opening');
    timers.current.push(window.setTimeout(() => setPhase('frame'), capri.glitch ? 720 : 10));
  };
  const close = () => {
    if (phase === 'sigil' || phase === 'closing') return;
    clearTimers();
    setPhase('closing');
    timers.current.push(
      window.setTimeout(() => {
        setPhase('sigil');
        setAwake(false);
      }, capri.glitch ? 620 : 10),
    );
  };
  useEffect(() => clearTimers, []);

  // attività: sveglia, e apri la finestra quando arriva una risposta
  useEffect(() => {
    if (busy) {
      lastActive.current = Date.now();
      setAwake(true);
    }
  }, [busy]);
  useEffect(() => {
    if (!balloon) return;
    lastActive.current = Date.now();
    setAwake(true);
    open();
  }, [balloon?.ts]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (exchangeTs) lastActive.current = Date.now();
  }, [exchangeTs]);

  // dormiente dopo inattività (non in DJ/search mode, né mentre è "attaccata")
  useEffect(() => {
    const t = window.setInterval(() => {
      const st = useApp.getState();
      if (st.status.listening || st.status.thinking || st.status.speaking || st.capriMode !== 'normal' || st.settings.capri.clingy || menu || lasso) return;
      if (document.activeElement?.id === 'capri-in' && (document.activeElement as HTMLInputElement).value) return;
      if (Date.now() - lastActive.current > capri.sleepSec * 1000) {
        if (phase === 'frame') close();
        else if (phase === 'sigil') setAwake(false);
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [capri.sleepSec, phase, menu, lasso]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile) return null;

  const onWheel = (e: React.WheelEvent) => {
    const next = Math.round(Math.min(900, Math.max(220, W * (e.deltaY < 0 ? 1.05 : 0.95))));
    setSettings((s) => ({ ...s, capri: { ...s.capri, frameWidth: next } }));
  };

  const bars: 'mic' | 'voice' | 'idle' = status.listening ? 'mic' : status.speaking ? 'voice' : 'idle';
  const sigilColor = COLOR[cstate];
  const showFrame = phase === 'frame' || phase === 'closing';
  const lightning = capri.dragMode === 'lightning';

  return (
    <>
      <div
        className="absolute"
        style={{ left: pos.x, top: pos.y, width: W, height: H, fontFamily: MONO }}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      >
        {/* ---------------- sigillo */}
        {(phase === 'sigil' || phase === 'opening') && (
          <div
            ref={sigilRef}
            className="absolute flex flex-col items-center gap-2"
            style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
            onContextMenu={onContext}
          >
            <motion.button
              type="button"
              aria-label={`${name}: tocca per parlare`}
              onClick={() => {
                lastActive.current = Date.now();
                setAwake(true);
                onListen();
              }}
              className="cursor-pointer bg-transparent p-0"
              animate={
                phase === 'opening'
                  ? { scale: [1, 0.15, 0], opacity: [1, 1, 0] }
                  : base === 'thinking'
                    ? { rotate: [0, 8, -8, 0], scale: [1, 1.06, 1] }
                    : base === 'listening'
                      ? { scale: [1, 1.08, 1] }
                      : { y: [0, -3, 0] }
              }
              transition={phase === 'opening' ? { duration: 0.22 } : { duration: base === 'dormant' ? 3.5 : 0.9, repeat: Infinity, ease: 'easeInOut' }}
            >
              {has('dormant') || (base !== 'dormant' && anyFrames && has('listen')) ? (
                <SpriteMedia path={frame} alt={`${name} sigillo`} className="block h-[96px] w-auto" />
              ) : (
                <DefaultSigil color={sigilColor} />
              )}
            </motion.button>
            {phase === 'sigil' && <Tag name={name} state={cstate} bars={base === 'listening' ? 'mic' : null} onPointerDown={onDragStart} />}
          </div>
        )}

        {/* ---------------- linea + glitch di apertura */}
        {phase === 'opening' && capri.glitch && (
          <>
            <motion.div
              aria-hidden="true"
              className="absolute left-0 h-[2px] w-full origin-center bg-[#00f0ff] shadow-[0_0_10px_#00f0ff]"
              style={{ top: '50%' }}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: [0, 0, 1, 1], scaleY: [1, 1, 1, 40], opacity: [0, 1, 1, 0] }}
              transition={{ duration: 0.62, times: [0, 0.3, 0.6, 1] }}
            />
            <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: [0, 0, 1] }} transition={{ duration: 0.7, times: [0, 0.5, 1] }}>
              <GlitchBurst ms={700} />
            </motion.div>
          </>
        )}

        {/* ---------------- finestra + terminale */}
        {showFrame && (
          <div
            ref={frameRef}
            className="absolute inset-0"
            onWheel={onWheel}
            onContextMenu={onContext}
            onPointerDown={(e) => {
              // in modalità LIGHTNING si può "lanciare" il fulmine anche dalla finestra
              if (lightning && e.button === 0 && !(e.target as HTMLElement).closest('form')) onDragStart(e);
            }}
          >
            <motion.div
              className="absolute inset-0"
              initial={phase === 'frame' ? { opacity: 0, clipPath: 'inset(45% 0 45% 0)' } : false}
              animate={
                phase === 'closing' || jump === 'out'
                  ? { opacity: [1, 0.6, 1, 0], clipPath: ['inset(0% 0 0% 0)', 'inset(20% 0 30% 0)', 'inset(46% 0 46% 0)', 'inset(50% 0 50% 0)'] }
                  : jump === 'in'
                    ? { opacity: [0, 1, 0.6, 1], clipPath: ['inset(50% 0 50% 0)', 'inset(30% 0 20% 0)', 'inset(5% 0 0% 0)', 'inset(0% 0 0% 0)'] }
                    : { opacity: 1, clipPath: 'inset(0% 0 0% 0)' }
              }
              transition={{ duration: phase === 'closing' ? 0.55 : jump ? 0.26 : 0.18 }}
            >
              <FrameView width={W} state={cstate} frame={frame} name={name} anyFrames={anyFrames} glitchOn={capri.glitch} />
              {(phase === 'closing' || jump) && capri.glitch && <GlitchBurst ms={400} />}
            </motion.div>
            {fxKind === 'clipped' && !has('clipped') && <EyeBurst key={fx?.ts} width={W} height={H} seconds={replaySec || 30} />}
            <div className="absolute" style={{ left: 10, top: -12 }}>
              <Tag name={name} state={cstate} bars={bars} onPointerDown={onDragStart} />
            </div>
            {phase === 'frame' && !jump && <Terminal name={name} width={W} busy={busy} />}
          </div>
        )}
      </div>

      {/* fulmine del drag LIGHTNING: dal centro-alto della finestra al cursore */}
      {lasso && <Lightning from={{ x: pos.x + W * 0.45, y: pos.y + 6 }} to={lasso} />}
      <AnimatePresence>{spark && <Sparks key={spark.k} x={spark.x} y={spark.y} />}</AnimatePresence>

      {/* lampo rosso sulla finestra "presa" dalla clingy mode */}
      {flash && (
        <motion.div
          className="pointer-events-none fixed"
          style={{ left: flash.x, top: flash.y, width: flash.w, height: Math.min(flash.h, 90), background: 'rgba(255,31,75,0.35)', zIndex: 30 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.4, 0.9, 0] }}
          transition={{ duration: 0.65 }}
          aria-hidden="true"
        />
      )}

      {menu && <CapriMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} onClingy={setClingy} />}
    </>
  );
}
