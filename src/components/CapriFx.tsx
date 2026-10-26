/**
 * Effetti della modalità Capri presi dal video:
 * - EyeBurst: occhio verde su esplosione rossa a punte quando salva un clip, poi occhietti ai bordi
 * - Lightning: il "lazo" a fulmine rosso del drag mode LIGHTNING
 * - Sparks: scintille cyan nel punto in cui Capri salta
 */
import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';

const RED = '#ff1f4b';
const GREEN = '#2bff88';
const INK = '#07070c';

function spikes(cx: number, cy: number, n: number, r1: number, r2: number, jitter = 0.18): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = (i % 2 ? r2 : r1) * (1 + (Math.random() * 2 - 1) * jitter);
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

/** Occhio a mandorla verde con iride rossa a cerchi concentrici. */
function Eye({ cx, cy, w, look = 0 }: { cx: number; cy: number; w: number; look?: number }) {
  const h = w * 0.52;
  const d = `M${cx - w / 2},${cy} Q${cx},${cy - h} ${cx + w / 2},${cy} Q${cx},${cy + h} ${cx - w / 2},${cy} Z`;
  const ir = h * 0.62;
  return (
    <g>
      <path d={d} fill={GREEN} stroke={INK} strokeWidth={w * 0.05} strokeLinejoin="round" />
      <circle cx={cx + look * w * 0.08} cy={cy} r={ir} fill={RED} stroke={INK} strokeWidth={w * 0.03} />
      <circle cx={cx + look * w * 0.08} cy={cy} r={ir * 0.7} fill="none" stroke={GREEN} strokeWidth={w * 0.025} />
      <circle cx={cx + look * w * 0.08} cy={cy} r={ir * 0.38} fill={GREEN} stroke={INK} strokeWidth={w * 0.02} />
      <circle cx={cx + look * w * 0.08} cy={cy} r={ir * 0.16} fill={RED} />
    </g>
  );
}

/** Esplosione con l'occhio (0-0.9 s), poi occhietti che spuntano dai bordi della finestra. */
export function EyeBurst({ width, height, seconds }: { width: number; height: number; seconds: number }) {
  const [stage, setStage] = useState<'burst' | 'eyes'>('burst');
  const star = useMemo(() => spikes(150, 100, 22, 96, 62, 0.22), []);
  const star2 = useMemo(() => spikes(150, 100, 22, 74, 50, 0.2), []);
  useEffect(() => {
    const t = window.setTimeout(() => setStage('eyes'), 900);
    return () => window.clearTimeout(t);
  }, []);
  const small = useMemo(
    () => [
      { x: -0.04, y: 0.12, w: 0.2 },
      { x: 0.32, y: -0.06, w: 0.1 },
      { x: 0.47, y: -0.05, w: 0.1 },
      { x: 0.62, y: -0.04, w: 0.11 },
      { x: 0.8, y: -0.02, w: 0.1 },
      { x: 1.02, y: 0.02, w: 0.1 },
      { x: 0.0, y: 0.82, w: 0.12 },
      { x: 0.18, y: 0.92, w: 0.12 },
      { x: 0.66, y: 0.98, w: 0.12 },
      { x: 0.86, y: 0.98, w: 0.1 },
      { x: 1.03, y: 0.84, w: 0.1 },
    ],
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {stage === 'burst' && (
        <motion.svg
          viewBox="0 0 300 200"
          className="absolute"
          style={{ left: '-12%', top: '-22%', width: '124%', height: '144%', overflow: 'visible' }}
          initial={{ scale: 0.2, rotate: -12, opacity: 0 }}
          animate={{ scale: [0.2, 1.12, 1, 1.02], rotate: [-12, 4, 0, 0], opacity: [0, 1, 1, 1] }}
          transition={{ duration: 0.45, times: [0, 0.45, 0.75, 1] }}
        >
          <polygon points={star} fill={RED} stroke={INK} strokeWidth="5" strokeLinejoin="round" />
          <polygon points={star2} fill="#c8102e" opacity="0.6" />
          <Eye cx={150} cy={100} w={150} />
          {/* fulmini bianchi ai lati */}
          <path d="M18,40 L40,62 L30,66 L54,92" stroke="#fff" strokeWidth="2.5" fill="none" />
          <path d="M262,18 L246,40 L258,44 L238,70" stroke="#fff" strokeWidth="2.5" fill="none" />
        </motion.svg>
      )}
      {stage === 'eyes' && (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full" style={{ overflow: 'visible' }}>
            {small.map((e, i) => (
              <motion.g
                key={i}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: [0, 1.25, 1], opacity: 1 }}
                transition={{ delay: i * 0.04, duration: 0.28 }}
                style={{ transformOrigin: `${e.x * width}px ${e.y * height}px` }}
              >
                <Eye cx={e.x * width} cy={e.y * height} w={e.w * width} look={i % 2 ? 1 : -1} />
              </motion.g>
            ))}
          </svg>
          <motion.div
            className="absolute right-[8%] bottom-[18%] border-2 bg-[#05050a] px-3 py-[2px] font-bold italic"
            style={{ borderColor: '#f2f0e6', color: '#f2f0e6', fontFamily: "'Rajdhani', 'Bahnschrift', sans-serif", fontSize: Math.max(13, width * 0.05), letterSpacing: 1 }}
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {`// CLIPPED\u00a0\u00a0${seconds}s`}
          </motion.div>
        </>
      )}
    </div>
  );
}

/** Percorso a zig-zag tra due punti, rigenerato a ogni frame per l'effetto "fulmine". */
function boltPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const n = Math.max(3, Math.min(9, Math.round(len / 70)));
  const pts: [number, number][] = [[x1, y1]];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const off = (Math.random() * 2 - 1) * Math.min(60, len * 0.12);
    pts.push([x1 + dx * t + nx * off, y1 + dy * t + ny * off]);
  }
  pts.push([x2, y2]);
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
}

/** Il lazo: un nastro rosso spezzato che va dalla finestra di Capri al cursore. */
export function Lightning({ from, to }: { from: { x: number; y: number }; to: { x: number; y: number } }) {
  const [d, setD] = useState(() => boltPath(from.x, from.y, to.x, to.y));
  useEffect(() => {
    setD(boltPath(from.x, from.y, to.x, to.y));
    const t = window.setInterval(() => setD(boltPath(from.x, from.y, to.x, to.y)), 70);
    return () => window.clearInterval(t);
  }, [from.x, from.y, to.x, to.y]);
  return (
    <svg className="pointer-events-none fixed inset-0 h-screen w-screen" aria-hidden="true" style={{ zIndex: 40 }}>
      <path d={d} stroke={RED} strokeWidth="9" fill="none" strokeLinejoin="miter" strokeLinecap="butt" opacity="0.35" />
      <path d={d} stroke={RED} strokeWidth="5" fill="none" strokeLinejoin="miter" strokeLinecap="butt" />
      {/* punta a freccia sul cursore */}
      <path d={`M${to.x - 9},${to.y - 3} L${to.x},${to.y} L${to.x - 3},${to.y - 10}`} stroke={RED} strokeWidth="4" fill="none" />
    </svg>
  );
}

/** Scintille cyan nel punto di atterraggio. */
export function Sparks({ x, y }: { x: number; y: number }) {
  const rays = useMemo(() => Array.from({ length: 9 }, (_, i) => ({ a: (i / 9) * Math.PI * 2 + Math.random() * 0.4, l: 14 + Math.random() * 22 })), []);
  return (
    <motion.svg
      className="pointer-events-none fixed"
      style={{ left: x - 50, top: y - 50, width: 100, height: 100, zIndex: 41 }}
      viewBox="0 0 100 100"
      initial={{ opacity: 1, scale: 0.4 }}
      animate={{ opacity: 0, scale: 1.4 }}
      transition={{ duration: 0.45 }}
      aria-hidden="true"
    >
      {rays.map((r, i) => (
        <line key={i} x1={50} y1={50} x2={50 + Math.cos(r.a) * r.l} y2={50 + Math.sin(r.a) * r.l} stroke="#7ff8ff" strokeWidth="2" />
      ))}
    </motion.svg>
  );
}
