/**
 * Mischief: overlay a tutto schermo mentre Capri "hackera" il desktop (Glitch di notme71/Capri-Desktop, MIT).
 * Stili sbloccati col sync: 0 barre, 1 strappo, 2 corruzione, 3 hex rain, 4 sync bar, 5 cursore inseguitore.
 * Sempre "gentile": niente lampi forti, click-through, Ctrl+Alt+C lo ferma.
 * Più il cut-in: una carta con gli occhi di Capri che scorre accanto a lei.
 */
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { usePet } from '../../lib/pet/bus';
import { poseUrl } from '../../lib/pet/pack';
import { MONO, NEON, cut } from './neon';

export const MISCHIEF_SECONDS = [2.6, 3.0, 2.8, 3.6, 4.0, 4.0];
const RED = [239, 58, 78];
const GREEN = [167, 245, 88];
const rgba = (c: number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a / 255))})`;

function dice(seed: number) {
  let s = seed | 0 || 1;
  const next = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  return { d: next, n: (max: number) => Math.floor(next() * Math.max(1, max)), r: (a: number, b: number) => a + Math.floor(next() * (b - a)) };
}

export function MischiefOverlay() {
  const m = usePet((s) => s.mischief);
  const stop = usePet((s) => s.stopMischief);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!m) return;
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g) return;
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    const chipUrl = poseUrl('chip');
    const chip = chipUrl ? Object.assign(new Image(), { src: chipUrl }) : null;
    const duration = m.sec;
    const t0 = performance.now();
    let chase = { x: 0, y: 0 };
    let cursor = { x: width / 2, y: height / 2 };
    let raf = 0;
    let poll = 0;
    if (m.kind === 5)
      poll = window.setInterval(() => {
        void invoke<{ cursor_x: number; cursor_y: number }>('pet_desk')
          .then((d) => (cursor = { x: d.cursor_x, y: d.cursor_y }))
          .catch(() => undefined);
      }, 50);
    const frame = () => {
      const age = (performance.now() - t0) / 1000;
      if (age >= duration) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, cv.width, cv.height);
        stop();
        return;
      }
      raf = requestAnimationFrame(frame);
      const fade = Math.max(0, Math.min(1, Math.min(age / 0.25, (duration - age) / 0.4)));
      const step = Math.floor(age / 0.125);
      const R = dice(step * 7919 + 13);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      // scanline e bordi rossi
      g.fillStyle = `rgba(0,0,0,${(24 * fade) / 255})`;
      for (let y = 0; y < height; y += 4) g.fillRect(0, y, width, 1);
      const edge = Math.max(40, width / 16);
      let gr = g.createLinearGradient(0, 0, edge, 0);
      gr.addColorStop(0, rgba(RED, 55 * fade));
      gr.addColorStop(1, rgba(RED, 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, edge, height);
      gr = g.createLinearGradient(width - edge, 0, width, 0);
      gr.addColorStop(0, rgba(RED, 0));
      gr.addColorStop(1, rgba(RED, 55 * fade));
      g.fillStyle = gr;
      g.fillRect(width - edge, 0, edge, height);

      if (m.kind === 0) {
        let budget = width * height * 0.06;
        const bars = 3 + R.n(4);
        for (let i = 0; i < bars; i++) {
          const bh = 3 + R.n(Math.max(4, height / 18));
          const bw = Math.floor(width * (0.15 + R.d() * 0.45));
          if (bh * bw * 2 > budget) continue;
          budget -= bh * bw * 2;
          const x = R.n(width - bw);
          const y = R.n(height - bh);
          const shift = 6 + R.n(24);
          g.fillStyle = rgba(RED, (40 + R.n(70)) * fade);
          g.fillRect(x - shift, y, bw, bh);
          g.fillStyle = rgba(GREEN, (40 + R.n(70)) * fade);
          g.fillRect(x + shift, y, bw, bh);
          if (R.n(3) === 0) {
            g.fillStyle = `rgba(0,0,0,${(70 * fade) / 255})`;
            g.fillRect(x, y + bh, bw, Math.max(2, bh / 3));
          }
        }
      } else if (m.kind === 1) {
        const bandY = (age / duration) * (height + 240) - 120;
        for (let k = 0; k < 4; k++) {
          const sh = 6 + R.n(16);
          const sw = Math.floor(width * (0.45 + R.d() * 0.5));
          const shift = 10 + R.n(50);
          const x = R.n(width - sw);
          g.fillStyle = rgba(k % 2 === 0 ? RED : GREEN, (60 + R.n(40)) * fade);
          g.fillRect(x + (k % 2 === 0 ? -shift : shift), bandY + k * 17, sw, sh);
        }
        g.fillStyle = `rgba(235,235,235,${(60 * fade) / 255})`;
        g.fillRect(0, bandY, width, 1);
      } else if (m.kind === 2) {
        let budget = width * height * 0.04;
        const blocks = 5 + R.n(6);
        for (let i = 0; i < blocks; i++) {
          const w = 12 + R.n(60),
            h = 12 + R.n(40);
          if (w * h > budget) continue;
          budget -= w * h;
          const x = R.n(width - w),
            y = R.n(height - h);
          const pick = R.n(3);
          g.fillStyle = pick === 0 ? rgba(RED, (50 + R.n(60)) * fade) : pick === 1 ? rgba(GREEN, (50 + R.n(60)) * fade) : `rgba(0,0,0,${(90 * fade) / 255})`;
          g.fillRect(x, y, w, h);
          for (let k = 0; k < 6; k++) g.fillRect(x + R.r(-40, w + 40), y + R.r(-20, h + 20), 4, 4);
        }
      } else if (m.kind === 3) {
        const digits = '0123456789ABCDEF';
        g.font = "bold 17px Consolas, 'Cascadia Mono', monospace";
        g.textBaseline = 'top';
        for (let side = 0; side < 2; side++)
          for (let col = 0; col < 7; col++) {
            const x = side === 0 ? 10 + col * 19 : width - 30 - col * 19;
            const headY = (age * 230 + col * 137 + side * 61) % (height + 300);
            for (let j = 0; j < 12; j++) {
              const y = headY - j * 19 - 100;
              if (y < -19 || y > height) continue;
              const a = (j === 0 ? 210 : 170 - j * 13) * fade;
              if (a <= 0) continue;
              const ch = digits[((step * 7 + col * 13 + j * 17 + side * 5) ^ (j * 31 + col)) & 15];
              g.fillStyle = j === 0 ? `rgba(230,255,210,${a / 255})` : rgba(GREEN, a);
              g.fillText(ch, x, y);
            }
          }
      } else if (m.kind === 4) {
        const bx = 40,
          by = Math.max(20, height - 210),
          bw = 400,
          bh = 84;
        const done = 0.87 * Math.min(1, age / Math.max(1, duration - 1.0));
        g.fillStyle = `rgba(6,6,8,${(200 * fade) / 255})`;
        g.fillRect(bx, by, bw, bh);
        g.strokeStyle = rgba(RED, 230 * fade);
        g.lineWidth = 1;
        g.strokeRect(bx + 0.5, by + 0.5, bw, bh);
        g.font = "bold 14px Consolas, 'Cascadia Mono', monospace";
        g.textBaseline = 'top';
        g.fillStyle = rgba(GREEN, 240 * fade);
        g.fillText('ENGRAM SYNC // CAPRI.EXE', bx + 14, by + 12);
        g.fillText(`${Math.floor(done * 100)}%`, bx + bw - 54, by + 12);
        g.fillStyle = `rgba(60,20,26,${(120 * fade) / 255})`;
        g.fillRect(bx + 14, by + 44, bw - 28, 14);
        g.fillStyle = rgba(RED, 235 * fade);
        g.fillRect(bx + 14, by + 44, (bw - 28) * done, 14);
      } else if (m.kind === 5) {
        const ang = age * 2.6;
        const target = { x: cursor.x + Math.cos(ang) * 48 + 30, y: cursor.y + Math.sin(ang) * 36 + 22 };
        if (age < 0.05) chase = { x: target.x + 160, y: target.y + 90 };
        chase = { x: chase.x + (target.x - chase.x) * 0.12, y: chase.y + (target.y - chase.y) * 0.12 };
        const arrow = [
          [0, 0],
          [0, 21],
          [5, 16],
          [9, 25],
          [13, 23],
          [9, 14],
          [16, 14],
        ];
        const path = (dx: number, dy: number) => {
          g.beginPath();
          arrow.forEach(([ax, ay], i) => (i ? g.lineTo(ax + chase.x + dx, ay + chase.y + dy) : g.moveTo(ax + chase.x + dx, ay + chase.y + dy)));
          g.closePath();
        };
        path(3, 2);
        g.fillStyle = rgba(GREEN, 90 * fade);
        g.fill();
        path(0, 0);
        g.fillStyle = rgba(RED, 230 * fade);
        g.fill();
        g.strokeStyle = `rgba(20,0,4,${(220 * fade) / 255})`;
        g.lineWidth = 1.5;
        g.stroke();
      }
      // il chip di Capri scivola dentro in alto a destra
      const size = 88;
      const slide = Math.min(1, age / 0.35) * Math.min(1, Math.max(0, (duration - age) / 0.4));
      const cx = width - 24 - size + (1 - slide * slide) * (size + 48) + R.r(-3, 4);
      g.globalAlpha = fade;
      if (chip && chip.complete && chip.naturalWidth) g.drawImage(chip, cx, 28, size, (size * chip.naturalHeight) / chip.naturalWidth);
      else {
        g.fillStyle = 'rgba(7,8,13,0.9)';
        g.fillRect(cx, 28, size, 60);
        g.strokeStyle = NEON.crimson;
        g.strokeRect(cx + 0.5, 28.5, size, 60);
        g.fillStyle = NEON.green;
        g.font = "bold 12px Consolas, monospace";
        g.fillText('CAPRI.EXE', cx + 10, 52);
      }
      g.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(poll);
    };
  }, [m?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!m) return null;
  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 h-full w-full" style={{ zIndex: 38 }} />;
}

/** Carta "cut-in": gli occhi di Capri entrano di lato (eyes, eyes-glitch, eyes-many...). */
export function CutIn() {
  const c = usePet((s) => s.cutin);
  const head = usePet((s) => s.head);
  const [, force] = useState(0);
  useEffect(() => {
    if (!c) return;
    const t = window.setTimeout(() => force((v) => v + 1), Math.max(0, c.until - Date.now()) + 50);
    return () => window.clearTimeout(t);
  }, [c?.until]); // eslint-disable-line react-hooks/exhaustive-deps
  const on = !!c && Date.now() < c.until && head.x >= 0;
  const url = c ? poseUrl(c.key) ?? poseUrl('eyes') : null;
  const W = Math.min(300, Math.max(200, head.size * 1.05));
  const left = head.x > window.innerWidth / 2;
  const x = left ? head.x - head.size * 0.55 - W : head.x + head.size * 0.45;
  const y = Math.max(8, head.y + head.size * 0.2);
  return (
    <AnimatePresence>
      {on && (
        <motion.div
          key={c!.until}
          data-noi18n=""
          className="pointer-events-none fixed overflow-hidden"
          style={{ left: Math.max(4, Math.min(x, window.innerWidth - W - 4)), top: y, width: W, height: W * 0.56, zIndex: 39, clipPath: cut(12), background: NEON.void, border: `1px solid ${NEON.crimson}` }}
          initial={{ clipPath: 'inset(0 100% 0 0)', opacity: 0.4 }}
          animate={{ clipPath: 'inset(0 0% 0 0)', opacity: 1 }}
          exit={{ clipPath: 'inset(0 0 0 100%)', opacity: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
        >
          {url ? (
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ fontFamily: MONO, color: NEON.green, fontSize: 13 }}>
              {'// SCANNING_'}
            </div>
          )}
          <div className="absolute top-1 left-2" style={{ fontFamily: MONO, color: NEON.crimson, fontSize: 9 }}>
            CAPRI.EXE // EYES
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
