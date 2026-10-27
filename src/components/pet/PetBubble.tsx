/**
 * Fumetto "Neon" sopra la testa del pet (da notme71/Capri-Desktop): angoli tagliati, bordo verde con segni cremisi,
 * ritratto che muove la bocca; la variante terminale (hack) scrive "> testo_" in verde su nero con bordo cremisi.
 * Più la casella per scriverle (matita) e i pulsanti rapidi che compaiono passando sopra di lei.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ask } from '../../lib/brain';
import { useHitRef } from '../../lib/hit';
import { usePet } from '../../lib/pet/bus';
import { L } from '../../lib/pet/lines';
import { poseUrl } from '../../lib/pet/pack';
import { useApp } from '../../lib/store';
import { FACE, MONO, NEON, cut } from './neon';

const TAIL = 10;

function useTyped(text: string, on: boolean, ts: number) {
  const [n, setN] = useState(on ? 0 : text.length);
  useEffect(() => {
    if (!on) {
      setN(text.length);
      return;
    }
    setN(0);
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const k = Math.min(text.length, Math.floor(((performance.now() - t0) / 1000) * 45));
      setN(k);
      if (k >= text.length) window.clearInterval(id);
    }, 30);
    return () => window.clearInterval(id);
  }, [text, on, ts]);
  return n;
}

export function PetBubble() {
  const bubble = usePet((s) => s.bubble);
  const head = usePet((s) => s.head);
  const hide = usePet((s) => s.hide);
  const thinking = useApp((s) => s.status.thinking);
  const speaking = useApp((s) => s.status.speaking);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [mouth, setMouth] = useState(false);

  // scadenza
  useEffect(() => {
    if (!bubble) return;
    const left = bubble.ts + bubble.sec * 1000 - Date.now();
    const t = window.setTimeout(() => {
      // se sta ancora parlando aspetta la fine della voce
      if (useApp.getState().status.speaking) {
        const w = window.setInterval(() => {
          if (!useApp.getState().status.speaking) {
            window.clearInterval(w);
            window.setTimeout(hide, 1200);
          }
        }, 300);
      } else hide();
    }, Math.max(500, left));
    return () => window.clearTimeout(t);
  }, [bubble?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  const terminal = bubble?.kind === 'hack' || bubble?.kind === 'np';
  const text = bubble ? (bubble.kind === 'np' ? `♪ ${bubble.text}` : bubble.text) : '';
  const typed = useTyped(text, terminal, bubble?.ts ?? 0);

  // bocca del ritratto mentre parla
  useEffect(() => {
    if (!speaking || terminal) {
      setMouth(false);
      return;
    }
    const id = window.setInterval(() => setMouth((m) => (Math.random() < 0.6 ? !m : m)), 110);
    return () => window.clearInterval(id);
  }, [speaking, terminal]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.width - size.w) > 1 || Math.abs(r.height - size.h) > 1) setSize({ w: r.width, h: r.height });
  });

  const show = !!bubble || thinking;
  if (!show || head.x < 0) return null;
  const faceClosed = !terminal ? poseUrl('talk-closed') : null;
  const faceOpen = poseUrl('talk-open') ?? faceClosed;
  const fontPx = Math.max(13, Math.min(17, head.size / 15));
  const W = size.w || 200;
  const H = size.h || 40;
  const x = Math.max(4, Math.min(head.x - W / 2, window.innerWidth - W - 4));
  const y = Math.max(4, head.y - H - TAIL + 2);
  const tail = Math.max(18, Math.min(W - 18, head.x - x));
  const edge = terminal ? NEON.crimson : NEON.green;
  const accent = terminal ? NEON.green : NEON.crimson;
  const c = 9;
  const outline = `${c},0.75 ${W - 0.75},0.75 ${W - 0.75},${H - c} ${W - c},${H - 0.75} ${tail + 7},${H - 0.75} ${tail},${H + TAIL - 1} ${tail - 7},${H - 0.75} 0.75,${H - 0.75} 0.75,${c}`;

  return (
    <AnimatePresence>
      <motion.div
        key={bubble?.ts ?? 'thinking'}
        data-noi18n=""
        className="pointer-events-none fixed select-none"
        style={{ left: x, top: y, zIndex: 40 }}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        role="status"
        aria-live="polite"
      >
        <svg className="absolute top-0 left-0" width={W} height={H + TAIL} style={{ overflow: 'visible' }} aria-hidden="true">
          <defs>
            <pattern id="pet-scan" width="3" height="3" patternUnits="userSpaceOnUse">
              <rect width="3" height="1" fill="rgba(255,255,255,0.055)" />
            </pattern>
          </defs>
          <polygon points={outline} fill="rgba(7,8,13,0.95)" />
          <polygon points={outline} fill="url(#pet-scan)" />
          <polygon points={outline} fill="none" stroke={edge} strokeOpacity={0.14} strokeWidth={4} />
          <polygon points={outline} fill="none" stroke={edge} strokeOpacity={0.86} strokeWidth={1} />
          <line x1={0.75} y1={c} x2={c} y2={0.75} stroke={accent} strokeWidth={2} />
          <line x1={W - 0.75} y1={H - c} x2={W - c} y2={H - 0.75} stroke={accent} strokeWidth={2} />
        </svg>
        <div ref={box} className="relative flex items-center gap-[10px]" style={{ padding: '8px 12px 8px 10px', maxWidth: terminal ? fontPx * 26 : fontPx * 18 + (faceClosed ? 114 : 0), minWidth: 56 }}>
          {faceClosed && (
            <div className="relative shrink-0 overflow-hidden" style={{ width: 104, height: 58, clipPath: cut(8), outline: `1.25px solid ${edge}` }}>
              <img src={(mouth && faceOpen) || faceClosed} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          {!bubble && thinking ? (
            <span style={{ fontFamily: MONO, color: NEON.green, fontSize: fontPx }}>
              {'> '}
              <motion.span animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 0.9 }}>
                ▮▯▯
              </motion.span>
            </span>
          ) : (
            <span style={{ fontFamily: terminal ? MONO : FACE, color: terminal ? NEON.green : NEON.text, fontSize: fontPx, lineHeight: 1.25, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {terminal ? `> ${text.slice(0, typed)}${typed < text.length ? '_' : ''}` : text}
            </span>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Casella per scriverle (matita / Ctrl+Alt+T). */
export function PetTyper() {
  const open = usePet((s) => s.typer);
  const head = usePet((s) => s.head);
  const setTyper = usePet((s) => s.setTyper);
  const ref = useHitRef('pet-typer');
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => input.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [open]);

  if (!open || head.x < 0) return null;
  const W = 300;
  const x = Math.max(4, Math.min(head.x - W / 2, window.innerWidth - W - 4));
  const below = head.y + head.size * 1.05;
  const y = below + 44 > window.innerHeight ? Math.max(4, head.y - 120) : below;
  const send = () => {
    const t = text.trim();
    if (t) void ask(t);
    setText('');
    setTyper(false);
  };
  return (
    <div
      ref={ref}
      data-noi18n=""
      className="fixed flex items-center gap-2"
      style={{ left: x, top: y, width: W, zIndex: 45, background: 'rgba(7,8,13,0.96)', clipPath: cut(8), border: `1px solid ${NEON.green}`, padding: '6px 10px' }}
    >
      <span style={{ fontFamily: MONO, color: NEON.crimson, fontSize: 14 }}>{'>'}</span>
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') send();
          if (e.key === 'Escape') setTyper(false);
        }}
        placeholder={L('scrivile qualcosa…', 'say something…', 'napisz coś…')}
        aria-label={L('Messaggio per Capri', 'Message for Capri', 'Wiadomość do Capri')}
        className="min-w-0 flex-1 bg-transparent outline-none"
        style={{ fontFamily: MONO, color: NEON.green, fontSize: 14 }}
      />
      <button type="button" onClick={send} aria-label={L('Invia', 'Send', 'Wyślij')} style={{ fontFamily: MONO, color: NEON.green, fontSize: 12 }}>
        ↵
      </button>
    </div>
  );
}

/** Pulsanti rapidi accanto a lei (matita = scrivi, onda = parla). */
export function PetPill({ visible, x, y, onListen }: { visible: boolean; x: number; y: number; onListen: () => void }) {
  const ref = useHitRef('pet-pill');
  const setTyper = usePet((s) => s.setTyper);
  const typer = usePet((s) => s.typer);
  const listening = useApp((s) => s.status.listening);
  if (!visible) return null;
  const btn = (label: string, on: boolean, onClick: () => void, icon: ReactNode) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-[26px] w-[26px] items-center justify-center"
      style={{ background: on ? 'rgba(0,255,110,0.14)' : 'rgba(7,8,13,0.92)', border: `1px solid ${on ? NEON.green : NEON.crimson}`, clipPath: cut(5), color: on ? NEON.green : NEON.text }}
    >
      {icon}
    </button>
  );
  return (
    <div ref={ref} data-noi18n="" className="fixed flex flex-col gap-[5px]" style={{ left: x, top: y, zIndex: 44 }}>
      {btn(L('Scrivile', 'Type to her', 'Napisz'), typer, () => setTyper(!typer), (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 14l1-4 8-8 3 3-8 8-4 1z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ))}
      {btn(L('Parlale', 'Talk to her', 'Mów'), listening, onListen, (
        <svg width="14" height="13" viewBox="0 0 16 14" aria-hidden="true">
          <path d="M1 7h2M4 4v6M7 2v10M10 4v6M13 6v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ))}
    </div>
  );
}
