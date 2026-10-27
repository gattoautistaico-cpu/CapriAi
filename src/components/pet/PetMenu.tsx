/** Menu del pet (tasto destro): stile Neon nero / cremisi / verde con angoli tagliati. */
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { setInteractive, useHitRef } from '../../lib/hit';
import { usePet, type PetAct } from '../../lib/pet/bus';
import { giveDare, syncPercent } from '../../lib/pet/life';
import { L } from '../../lib/pet/lines';
import { useApp } from '../../lib/store';
import { FACE, MONO, NEON, cut } from './neon';

const SIZES: [number, string, string, string][] = [
  [170, 'Piccola', 'Small', 'Mała'],
  [240, 'Media', 'Medium', 'Średnia'],
  [320, 'Grande', 'Large', 'Duża'],
  [440, 'Enorme', 'Huge', 'Ogromna'],
];

type Item = { kind: 'sec'; label: string } | { kind: 'item'; id: string; label: string; value?: string; on?: boolean; run: () => void };

export function PetMenu({ x, y, state, sleeping, onClose, onListen, onMischief }: { x: number; y: number; state: string; sleeping: boolean; onClose: () => void; onListen: () => void; onMischief: () => void }) {
  const ref = useHitRef('pet-menu');
  const box = useRef<HTMLDivElement | null>(null);
  const pet = useApp((s) => s.settings.pet);
  const setSettings = useApp((s) => s.setSettings);
  const setPanel = useApp((s) => s.setPanel);
  const act = usePet((s) => s.act);
  const [pos, setPos] = useState({ x, y });
  const [hover, setHover] = useState('');

  useEffect(() => {
    setInteractive(true);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
      setInteractive(useApp.getState().lockInteractive);
    };
  }, [onClose]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(window.innerWidth - r.width - 8, x)), y: Math.max(8, Math.min(window.innerHeight - r.height - 8, y)) });
  }, [x, y]);

  const doAct = (a: PetAct) => () => {
    act(a);
    onClose();
  };
  const setPet = (fn: (p: typeof pet) => typeof pet) => setSettings((s) => ({ ...s, pet: fn(s.pet) }));
  const sz = SIZES.find((z) => z[0] === pet.size) ?? SIZES[1];
  const perched = state === 'perch';
  const riding = state === 'ride';

  const items: Item[] = [
    { kind: 'sec', label: '// TALK' },
    { kind: 'item', id: 'type', label: L('SCRIVILE', 'TYPE TO HER', 'NAPISZ'), value: 'CTRL+ALT+T', run: () => (usePet.getState().setTyper(true), onClose()) },
    { kind: 'item', id: 'voice', label: L('PARLALE', 'TALK', 'MÓW'), value: 'CTRL+ALT+V', run: () => (onListen(), onClose()) },
    { kind: 'item', id: 'dare', label: L('SFIDAMI', 'DARE ME', 'WYZWANIE'), run: () => (void giveDare(true), onClose()) },
    { kind: 'sec', label: '// MOVE' },
    perched ? { kind: 'item', id: 'stand', label: L('ALZATI', 'STAND UP', 'WSTAŃ'), run: doAct('standup') } : { kind: 'item', id: 'sit', label: L('SIEDITI QUI', 'SIT HERE', 'USIĄDŹ TU'), run: doAct('sit') },
    riding
      ? { kind: 'item', id: 'hop', label: L('SCENDI DAL CURSORE', 'HOP OFF', 'ZEJDŹ'), value: 'CTRL+ALT+C', run: doAct('hopoff') }
      : { kind: 'item', id: 'ride', label: L('SALI SUL CURSORE', 'RIDE CURSOR', 'JEDŹ NA KURSORZE'), run: doAct('ride') },
    { kind: 'item', id: 'hopwin', label: L('SALTA SU UNA FINESTRA', 'HOP ON A WINDOW', 'SKOCZ NA OKNO'), run: doAct('hopwin') },
    { kind: 'item', id: 'peek', label: L('SBIRCIA', 'PEEK', 'ZERKNIJ'), run: doAct('peek') },
    { kind: 'item', id: 'sleep', label: sleeping ? L('SVEGLIATI', 'WAKE UP', 'OBUDŹ SIĘ') : L('DORMI', 'SLEEP', 'ŚPIJ'), run: doAct(sleeping ? 'wake' : 'sleep') },
    { kind: 'item', id: 'summon', label: L('RIPORTALA QUI', 'BRING HER BACK', 'PRZYWOŁAJ'), run: doAct('summon') },
    { kind: 'sec', label: '// BEHAVIOR' },
    { kind: 'item', id: 'mischief', label: 'MISCHIEF', value: pet.mischief ? 'ON' : 'OFF', on: pet.mischief, run: () => setPet((p) => ({ ...p, mischief: !p.mischief })) },
    { kind: 'item', id: 'hack', label: L('HACKERA ORA', 'HACK NOW', 'HAKUJ TERAZ'), run: () => (onMischief(), onClose()) },
    { kind: 'item', id: 'wander', label: L('VAGABONDA', 'WANDER', 'WĘDRUJ'), value: pet.wander ? 'ON' : 'OFF', on: pet.wander, run: () => setPet((p) => ({ ...p, wander: !p.wander })) },
    { kind: 'item', id: 'notices', label: L('COMMENTI', 'NOTICES', 'KOMENTARZE'), value: pet.notices ? 'ON' : 'OFF', on: pet.notices, run: () => setPet((p) => ({ ...p, notices: !p.notices })) },
    {
      kind: 'item',
      id: 'size',
      label: L('TAGLIA', 'SIZE', 'ROZMIAR'),
      value: L(sz[1], sz[2], sz[3]).toUpperCase(),
      on: true,
      run: () => setPet((p) => ({ ...p, size: SIZES[(SIZES.findIndex((z) => z[0] === p.size) + 1) % SIZES.length][0] })),
    },
    { kind: 'item', id: 'sync', label: 'SYNC', value: `${syncPercent()}%`, on: true, run: () => (usePet.getState().show(`SYNC ${syncPercent()}%`, 'hack', 3), onClose()) },
    { kind: 'sec', label: '// SYSTEM' },
    { kind: 'item', id: 'settings', label: L('IMPOSTAZIONI', 'SETTINGS', 'USTAWIENIA'), run: () => (setPanel('settings', 'pet'), onClose()) },
    { kind: 'item', id: 'mode', label: L('MODALITÀ OVERLAY', 'OVERLAY MODE', 'TRYB NAKŁADKI'), run: () => (setSettings((s) => ({ ...s, ui: { ...s.ui, mode: 'capri' } })), onClose()) },
    { kind: 'item', id: 'quit', label: L('ESCI', 'QUIT', 'ZAMKNIJ'), run: () => void invoke('quit_app') },
  ];

  return (
    <>
      <div className="fixed inset-0" style={{ zIndex: 49 }} onPointerDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <motion.div
        ref={(el) => {
          box.current = el;
          ref(el);
        }}
        role="menu"
        data-noi18n=""
        aria-label="Capri"
        className="fixed select-none"
        style={{ left: pos.x, top: pos.y, width: 268, zIndex: 50, background: 'rgba(7,8,13,0.97)', clipPath: cut(10), border: `1px solid ${NEON.crimson}`, boxShadow: `0 0 16px rgba(255,20,70,0.25)` }}
        initial={{ opacity: 0, scaleY: 0.3 }}
        animate={{ opacity: 1, scaleY: 1 }}
        transition={{ duration: 0.13 }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="flex items-center justify-between px-3 pt-2">
          <span style={{ fontFamily: FACE, fontWeight: 700, color: NEON.text, fontSize: 17, letterSpacing: 1 }}>CAPRI</span>
          <span style={{ fontFamily: MONO, color: NEON.green, fontSize: 10 }}>SYNC {syncPercent()}%</span>
        </div>
        <div className="mx-3 mt-1 h-[2px]" style={{ background: `linear-gradient(90deg, ${NEON.green} 0 ${Math.max(4, syncPercent())}%, ${NEON.line} ${Math.max(4, syncPercent())}% 100%)` }} />
        <div className="max-h-[70vh] overflow-y-auto px-1 py-1">
          {items.map((it, i) =>
            it.kind === 'sec' ? (
              <div key={i} className="px-3 pt-2 pb-[2px]" style={{ fontFamily: MONO, fontSize: 9, color: NEON.dim }}>
                {it.label}
              </div>
            ) : (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                onMouseEnter={() => setHover(it.id)}
                onMouseLeave={() => setHover('')}
                onFocus={() => setHover(it.id)}
                onClick={it.run}
                className="flex w-full items-center gap-2 px-3 text-left"
                style={{ height: 24, background: hover === it.id ? 'rgba(0,255,110,0.08)' : 'transparent', borderLeft: `2px solid ${hover === it.id ? NEON.green : 'transparent'}` }}
              >
                <span className="flex-1" style={{ fontFamily: FACE, fontWeight: 600, fontSize: 13, color: hover === it.id ? NEON.green : NEON.text, letterSpacing: 0.4 }}>
                  {it.label}
                </span>
                {it.value && <span style={{ fontFamily: MONO, fontSize: 10, color: it.on ? NEON.green : NEON.dim }}>{it.value}</span>}
              </button>
            ),
          )}
        </div>
      </motion.div>
    </>
  );
}
