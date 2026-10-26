import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useHitRef } from '../lib/hit';
import { useApp } from '../lib/store';
import { SpriteMedia } from './SpriteMedia';
import { useSpriteFrame } from '../lib/useSprite';
import { Balloon, Dock } from './Overlay';
import { Btn } from './ui';

export function Avatar({ onMic }: { onMic: () => void }) {
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.settings.activeProfileId) ?? s.profiles[0]);
  const status = useApp((s) => s.status);
  const updateProfile = useApp((s) => s.updateProfile);
  const setPanel = useApp((s) => s.setPanel);
  const hitRef = useHitRef('avatar');

  const layout = profile?.layout;
  const width = layout?.width ?? 320;
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  // posizione iniziale: in basso a destra
  useEffect(() => {
    if (!layout) return;
    const x = layout.x < 0 ? window.innerWidth - width - 48 : layout.x;
    const y = layout.y < 0 ? window.innerHeight - width * 1.6 - 60 : layout.y;
    setPos({ x: Math.max(0, x), y: Math.max(0, y) });
  }, [profile?.id, layout?.x, layout?.y]); // eslint-disable-line react-hooks/exhaustive-deps

  const { frame, anyFrames } = useSpriteFrame(profile);

  if (!profile || !layout) return null;

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.moved = true;
    setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
  };
  const onUp = () => {
    if (!drag.current) return;
    if (drag.current.moved) {
      updateProfile(profile.id, (p) => ({ ...p, layout: { ...p.layout, x: Math.round(pos.x), y: Math.round(pos.y) } }));
    }
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    const next = Math.round(Math.min(900, Math.max(120, width * (e.deltaY < 0 ? 1.06 : 0.94))));
    updateProfile(profile.id, (p) => ({ ...p, layout: { ...p.layout, width: next } }));
  };

  return (
    <div
      ref={hitRef}
      className="absolute touch-none"
      style={{ left: pos.x, top: pos.y, width }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onWheel={onWheel}
      onDoubleClick={() => setPanel('chat')}
      onContextMenu={(e) => {
        e.preventDefault();
        setPanel('settings', 'avatar');
      }}
      title={`${profile.name} · trascina per spostare, rotella per scalare, doppio click = chat, tasto destro = impostazioni`}
    >
      {anyFrames && frame ? (
        <motion.div
          style={{ transformOrigin: '50% 100%', scaleX: layout.flip ? -1 : 1 }}
          animate={layout.breathing ? { scaleY: [1, 1.014, 1], y: [0, -2, 0] } : undefined}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <SpriteMedia path={frame} alt={`Avatar ${profile.name}`} className="block w-full select-none" />
        </motion.div>
      ) : (
        <div className="stripes flex aspect-[2/3] w-full flex-col items-center justify-center gap-3 border-2 border-dashed border-yellow/75 p-6 text-center">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#fcee0a" strokeWidth="1.5" aria-hidden="true">
            <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M12 8v8M8 12h8" />
          </svg>
          <div className="font-display text-[20px] font-black italic tracking-[2px] text-yellow">NESSUN AVATAR</div>
          <div className="text-[16px]">Importa gli sprite del tuo personaggio. Sfondo trasparente consigliato.</div>
          <div className="font-mono text-[11px] text-muted">PNG / WebP / GIF con alpha</div>
          <Btn variant="primary" onClick={() => setPanel('settings', 'avatar')}>
            + Importa sprite
          </Btn>
        </div>
      )}
      <div className="pointer-events-none mx-6 mt-1 h-[2px] bg-cyan shadow-[0_0_14px_#00f0ff] opacity-70" />
      {status.listening && (
        <div className="absolute top-2 left-2 border border-red bg-void/80 px-2 py-[2px] font-mono text-[11px] text-red">● REC</div>
      )}
      <Balloon />
      <Dock onMic={onMic} />
    </div>
  );
}
