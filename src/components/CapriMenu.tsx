/**
 * Menu "CAPRI" (tasto destro), identico al video: sezioni // AUDIO, // MEMORY, // INSTANT REPLAY,
 * // BEHAVIOR, voci rosse con rombo, valori a destra, voce attiva con contorno cyan.
 */
import { invoke } from '@tauri-apps/api/core';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { resetConversation } from '../lib/brain';
import { say } from '../lib/commands';
import { setInteractive, useHitRef } from '../lib/hit';
import { T } from '../lib/i18n';
import { openClipsFolder } from '../lib/replay';
import { activeProfile, log, useApp } from '../lib/store';
import { stopSpeaking } from '../lib/tts';

const RED = '#ff2a4f';
const DIM = '#7a2a3a';
const CYAN = '#00f0ff';
const YELLOW = '#fcee0a';
const MONO = "'Share Tech Mono', 'Cascadia Mono', Consolas, monospace";
const UI = "'Rajdhani', 'Bahnschrift SemiCondensed', 'Bahnschrift', sans-serif";
const VERSION = 'v0.7.0';

/** "CommandOrControl+Alt+C" → "CTRL+ALT+C" */
const keyLabel = (k: string) => k.replace(/CommandOrControl|CmdOrCtrl|Control/gi, 'CTRL').toUpperCase();

let lastVoice: 'piper' | 'webspeech' | 'elevenlabs' = 'piper';

type Item =
  | { kind: 'section'; label: string }
  | { kind: 'item'; id: string; label: string; value?: string; on?: boolean; run: () => void }
  | { kind: 'gap' };

export function CapriMenu({ x, y, onClose, onClingy }: { x: number; y: number; onClose: () => void; onClingy: (on: boolean) => void }) {
  const ref = useHitRef('capri-menu');
  const box = useRef<HTMLDivElement | null>(null);
  const s = useApp((st) => st.settings);
  const profile = useApp((st) => st.profiles.find((p) => p.id === st.settings.activeProfileId) ?? st.profiles[0]);
  const setSettings = useApp((st) => st.setSettings);
  const updateProfile = useApp((st) => st.updateProfile);
  const setPanel = useApp((st) => st.setPanel);
  const [hover, setHover] = useState('');
  const [pos, setPos] = useState({ x, y });

  // tutta la finestra cattura i click finché il menu è aperto: un click fuori lo chiude
  useEffect(() => {
    setInteractive(true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      setInteractive(useApp.getState().lockInteractive);
    };
  }, [onClose]);

  // resta dentro lo schermo
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(window.innerWidth - r.width - 8, x)), y: Math.max(8, Math.min(window.innerHeight - r.height - 8, y)) });
  }, [x, y]);

  const effVoice = profile && profile.voice.engine !== 'default' ? profile.voice.engine : s.tts.engine;
  const setVoice = (e: 'piper' | 'webspeech' | 'elevenlabs' | 'blips' | 'off') => {
    stopSpeaking();
    if (profile && profile.voice.engine !== 'default') updateProfile(profile.id, (p) => ({ ...p, voice: { ...p.voice, engine: e } }));
    else setSettings((x2) => ({ ...x2, tts: { ...x2.tts, engine: e } }));
  };

  const items: Item[] = [
    { kind: 'section', label: '// AUDIO' },
    {
      kind: 'item',
      id: 'mic',
      label: 'MICROPHONE',
      value: s.stt.muted ? 'MUTED' : 'ON',
      on: !s.stt.muted,
      run: () => setSettings((x2) => ({ ...x2, stt: { ...x2.stt, muted: !x2.stt.muted } })),
    },
    {
      kind: 'item',
      id: 'voice',
      label: 'VOICE',
      value: effVoice === 'off' ? 'OFF' : effVoice === 'blips' ? 'BLIPS' : 'ON',
      on: effVoice !== 'off',
      run: () => {
        // ON (voce) → BLIPS (stile Undertale) → OFF → ON
        if (effVoice === 'off') setVoice(lastVoice);
        else if (effVoice === 'blips') setVoice('off');
        else {
          if (effVoice === 'piper' || effVoice === 'webspeech' || effVoice === 'elevenlabs') lastVoice = effVoice;
          setVoice('blips');
        }
      },
    },
    { kind: 'section', label: '// MEMORY' },
    {
      kind: 'item',
      id: 'forget',
      label: 'FORGET CONVERSATION',
      run: () => {
        resetConversation();
        useApp.getState().setExchange({ user: '', np: '', sys: 'conversation wiped' });
        say(T('Fatto. Non ricordo più niente di quello che ci siamo detti.'), 'smug');
        onClose();
      },
    },
    {
      kind: 'item',
      id: 'reload',
      label: 'RELOAD PERSONALITY',
      run: () => {
        resetConversation();
        useApp.getState().setCapriFx('rewiring');
        useApp.getState().setExchange({ user: '', np: '', sys: `personality: ${profile?.personalityId ?? '-'}` });
        say(T('Personalità ricaricata. Sono di nuovo io.'), 'happy');
        onClose();
      },
    },
    { kind: 'section', label: '// INSTANT REPLAY' },
    {
      kind: 'item',
      id: 'replay',
      label: 'INSTANT REPLAY',
      value: s.replay.enabled ? 'ON' : 'OFF',
      on: s.replay.enabled,
      run: () => setSettings((x2) => ({ ...x2, replay: { ...x2.replay, enabled: !x2.replay.enabled } })),
    },
    {
      kind: 'item',
      id: 'clips',
      label: 'OPEN CLIPS FOLDER',
      value: keyLabel(s.keys.openClips),
      on: true,
      run: () => {
        void openClipsFolder().catch((e) => log('error', 'replay', String(e)));
        onClose();
      },
    },
    {
      kind: 'item',
      id: 'keys',
      label: 'EDIT KEYBIND SHORTCUTS',
      run: () => {
        setPanel('settings', 'clip');
        onClose();
      },
    },
    { kind: 'section', label: '// BEHAVIOR' },
    {
      kind: 'item',
      id: 'clingy',
      label: 'CLINGY MODE',
      value: s.capri.clingy ? 'ON' : 'OFF',
      on: s.capri.clingy,
      run: () => {
        onClingy(!s.capri.clingy);
        onClose();
      },
    },
    {
      kind: 'item',
      id: 'drag',
      label: 'DRAG MODE',
      value: s.capri.dragMode === 'lightning' ? 'LIGHTNING' : 'NORMAL',
      on: s.capri.dragMode === 'lightning',
      run: () => setSettings((x2) => ({ ...x2, capri: { ...x2.capri, dragMode: x2.capri.dragMode === 'lightning' ? 'normal' : 'lightning' } })),
    },
    {
      kind: 'item',
      id: 'pet',
      label: 'DESKTOP PET',
      value: 'OFF',
      run: () => {
        setSettings((x2) => ({ ...x2, ui: { ...x2.ui, mode: 'pet' } }));
        onClose();
      },
    },
    {
      kind: 'item',
      id: 'settings',
      label: 'SETTINGS',
      run: () => {
        setPanel('settings', 'capri');
        onClose();
      },
    },
    { kind: 'gap' },
    { kind: 'item', id: 'quit', label: 'QUIT', run: () => void invoke('quit_app') },
  ];

  const name = (activeProfile()?.name ?? 'Capri').toUpperCase();

  return (
    <>
      {/* velo invisibile: un click fuori dal menu lo chiude */}
      <div className="fixed inset-0" style={{ zIndex: 49 }} onPointerDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <motion.div
        ref={(el) => {
          box.current = el;
          ref(el);
        }}
        role="menu"
        data-noi18n=""
        aria-label={`${name} menu`}
        className="fixed select-none"
        style={{
          left: pos.x,
          top: pos.y,
          width: 296,
          zIndex: 50,
          background: 'rgba(16,4,9,0.97)',
          border: `1px solid ${RED}88`,
          boxShadow: `0 0 0 1px #000, 0 0 18px ${RED}33`,
          clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))',
        }}
        initial={{ opacity: 0, scaleY: 0.2 }}
        animate={{ opacity: 1, scaleY: 1 }}
        transition={{ duration: 0.14 }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* intestazione */}
        <div className="flex items-start justify-between px-4 pt-3">
          <div>
            <div style={{ fontFamily: UI, fontWeight: 700, fontSize: 21, color: YELLOW, letterSpacing: 0.5, lineHeight: 1 }}>{name}</div>
          </div>
          <div className="text-right" style={{ fontFamily: MONO, fontSize: 9, color: DIM, lineHeight: 1.25 }}>
            NC//SYS.MENU
            <br />
            0x2077 // ONLINE
          </div>
        </div>
        <div className="relative mx-4 mt-2 h-[2px]" style={{ background: `${RED}66` }}>
          <div className="absolute top-0 left-0 h-[2px]" style={{ width: Math.min(140, name.length * 12 + 14), background: CYAN }} />
        </div>
        {/* voci */}
        <div className="px-1 pt-1 pb-1">
          {items.map((it, i) => {
            if (it.kind === 'section')
              return (
                <div key={i} className="px-3 pt-2 pb-[2px]" style={{ fontFamily: MONO, fontSize: 9, color: DIM }}>
                  {it.label}
                </div>
              );
            if (it.kind === 'gap') return <div key={i} className="h-3" />;
            const hov = hover === it.id;
            return (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                onMouseEnter={() => setHover(it.id)}
                onMouseLeave={() => setHover('')}
                onFocus={() => setHover(it.id)}
                onClick={it.run}
                className="flex w-full cursor-pointer items-center gap-2 px-3 text-left"
                style={{
                  height: 25,
                  border: `1px solid ${hov ? CYAN : 'transparent'}`,
                  background: hov ? 'rgba(0,240,255,0.06)' : 'transparent',
                  boxShadow: hov ? `0 0 8px ${CYAN}44` : 'none',
                }}
              >
                <span style={{ color: hov ? CYAN : RED, fontSize: 9 }}>◇</span>
                <span className="flex-1" style={{ fontFamily: UI, fontWeight: 700, fontSize: 15, color: hov ? CYAN : RED, letterSpacing: 0.3 }}>
                  {it.label}
                </span>
                {it.value && (
                  <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, color: it.on ? CYAN : DIM, letterSpacing: 0.5 }}>{it.value}</span>
                )}
                {hov && (
                  <span className="ml-1 flex h-[15px] w-[15px] items-center justify-center" style={{ border: `1px solid ${CYAN}`, color: CYAN, fontSize: 10, lineHeight: 1 }}>
                    –
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between px-4 pt-1 pb-2" style={{ fontFamily: MONO, fontSize: 9, color: DIM }}>
          <span>{VERSION}</span>
          <span>[ESC] CLOSE</span>
        </div>
      </motion.div>
    </>
  );
}
