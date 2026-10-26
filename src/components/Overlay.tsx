import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { visionTick } from '../lib/brain';
import { useHitRef } from '../lib/hit';
import { personalityById } from '../lib/personalities';
import { useApp } from '../lib/store';
import { stopSpeaking } from '../lib/tts';

/** Fumetto con l'ultima risposta, sopra l'avatar. */
export function Balloon() {
  const balloon = useApp((s) => s.balloon);
  const sec = useApp((s) => s.settings.ui.balloonSec);
  const speaking = useApp((s) => s.status.speaking);
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.settings.activeProfileId));
  const ref = useHitRef('balloon');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!balloon) return;
    setVisible(true);
  }, [balloon]);
  useEffect(() => {
    if (!visible || speaking) return;
    const t = window.setTimeout(() => setVisible(false), sec * 1000);
    return () => window.clearTimeout(t);
  }, [visible, speaking, sec, balloon]);

  const color = personalityById(profile?.personalityId ?? '').color;
  return (
    <AnimatePresence>
      {visible && balloon && (
        <motion.div
          ref={ref}
          key={balloon.ts}
          initial={{ opacity: 0, y: 8, skewX: -4 }}
          animate={{ opacity: 1, y: 0, skewX: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          onClick={() => setVisible(false)}
          onPointerDown={(e) => e.stopPropagation()}
          className="glass cut-br absolute right-0 bottom-full mb-3 w-[min(440px,80vw)] cursor-pointer border border-l-[6px] px-4 py-3"
          style={{ borderColor: color }}
        >
          <div className="mb-1 flex justify-between font-mono text-[11px] tracking-[1px]" style={{ color }}>
            <span>
              {(profile?.name ?? 'AI').toUpperCase()} // {balloon.mood.toUpperCase()}
            </span>
            <span className="text-dim">click = chiudi</span>
          </div>
          <div className="text-[19px] leading-snug font-semibold text-fg">{balloon.text}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DockBtn({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-11 w-11 cursor-pointer items-center justify-center border bg-void/80 transition ${
        active ? 'border-red text-red shadow-[0_0_12px_#ff003c]' : 'border-edge text-yellow hover:border-yellow'
      }`}
    >
      {children}
    </button>
  );
}

/** Barra comandi verticale accanto all'avatar. */
export function Dock({ onMic }: { onMic: () => void }) {
  const ref = useHitRef('dock');
  const listening = useApp((s) => s.status.listening);
  const continuous = useApp((s) => s.settings.stt.continuous);
  const speaking = useApp((s) => s.status.speaking);
  const setPanel = useApp((s) => s.setPanel);
  const panel = useApp((s) => s.panel);
  const icon = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, width: 20, height: 20, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
  return (
    <div ref={ref} className="absolute top-4 right-full mr-3 flex flex-col gap-2" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <DockBtn label={continuous ? 'Ascolto continuo attivo (click per disattivare)' : 'Ascolto continuo'} active={continuous || listening} onClick={onMic}>
        <svg {...icon}>
          <rect x="9" y="3" width="6" height="11" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </DockBtn>
      <DockBtn label="Guarda lo schermo ora" onClick={() => void visionTick(true)}>
        <svg {...icon}>
          <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </DockBtn>
      <DockBtn label="Chat" active={panel === 'chat'} onClick={() => setPanel(panel === 'chat' ? 'none' : 'chat')}>
        <svg {...icon}>
          <path d="M4 4h16v12H9l-5 4z" />
        </svg>
      </DockBtn>
      {speaking && (
        <DockBtn label="Zitta" onClick={stopSpeaking}>
          <svg {...icon}>
            <rect x="6" y="6" width="12" height="12" />
          </svg>
        </DockBtn>
      )}
      <DockBtn label="Impostazioni" active={panel === 'settings'} onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}>
        <svg {...icon}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
        </svg>
      </DockBtn>
    </div>
  );
}

/** Barra di stato in alto a destra: provider/modello attivo, VRAM, servizi. */
export function Hud() {
  const show = useApp((s) => s.settings.ui.showHud);
  const status = useApp((s) => s.status);
  const cap = useApp((s) => s.settings.local.vramCapGb);
  const vision = useApp((s) => s.settings.vision.enabled);
  const ref = useHitRef('hud');
  if (!show) return null;
  const tone =
    status.provider === 'local' ? 'text-ok' : status.provider === 'gemini' ? 'text-cyan' : status.provider === 'openrouter' ? 'text-warn' : 'text-dim';
  const vramHigh = status.vramGb !== null && status.vramGb > cap;
  return (
    <div ref={ref} className="absolute top-4 right-4 flex h-10 items-stretch font-mono text-[12px]">
      <div className="cut-slab glitch flex items-center bg-yellow pr-6 pl-4 font-display text-[16px] font-black tracking-[3px] text-void italic">
        CYBER AI
      </div>
      <div className="glass -ml-2 flex items-center gap-4 border-t-2 border-yellow pr-4 pl-6" style={{ clipPath: 'polygon(16px 0, 100% 0, 100% 100%, 0 100%)' }}>
        <span className={tone}>
          ● {status.provider.toUpperCase()} {status.model}
        </span>
        {status.vramGb !== null && (
          <span className={vramHigh ? 'text-red' : 'text-cyan'}>
            VRAM {status.vramGb.toFixed(1)}/{cap}
          </span>
        )}
        <span className={status.sttReady ? 'text-ok' : 'text-dim'}>STT</span>
        <span className={vision ? 'text-cyan' : 'text-dim'}>VISION</span>
        {status.thinking && <span className="text-magenta">ELABORO…</span>}
      </div>
    </div>
  );
}
