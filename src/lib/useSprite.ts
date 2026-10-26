import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from './store';
import { getVoiceLevel } from './tts';
import type { Profile } from './types';

/** GIF predefinite (Happy e Talking) usate quando l'outfit non ha frame per quello stato. */
export const DEFAULT_SPRITES: Record<string, string[]> = { happy: ['/default/happy.gif'], talk: ['/default/talk.gif'] };
export const fileSrc = (p: string) => (p.startsWith('/default/') ? p : convertFileSrc(p));
export const isAnimated = (p: string) => /\.(webm|mp4|mov|gif)$/i.test(p);

export function withDefaults(states: Record<string, string[]>): Record<string, string[]> {
  const out = { ...states };
  for (const [k, v] of Object.entries(DEFAULT_SPRITES)) if (!(out[k]?.length)) out[k] = v;
  return out;
}
export const isVideo = (p: string) => /\.(webm|mp4|mov)$/i.test(p);

/**
 * Sceglie il frame corrente dell'avatar: stato (talk/listen/think/mood),
 * ciclo a FPS, blink casuale, lip sync sul volume della voce.
 * `forceState` permette alla modalità Capri di imporre ad es. "dormant".
 */
export function useSpriteFrame(profile: Profile | undefined, forceState?: string) {
  const status = useApp((s) => s.status);
  const transientMood = useApp((s) => s.transientMood);
  const outfit = profile?.outfits.find((o) => o.id === profile.activeOutfitId) ?? profile?.outfits[0];
  const states = withDefaults(outfit?.states ?? {});
  const has = (k: string) => (states[k]?.length ?? 0) > 0;
  const anyFrames = Object.values(states).some((a) => a.length > 0);

  useEffect(() => {
    Object.values(states)
      .flat()
      .filter((p) => !isVideo(p))
      .forEach((p) => {
        const i = new Image();
        i.src = fileSrc(p);
      });
  }, [outfit]); // eslint-disable-line react-hooks/exhaustive-deps

  const restState = useMemo(() => {
    if (transientMood && has(transientMood)) return transientMood;
    if (profile && has(profile.mood)) return profile.mood;
    if (has('idle')) return 'idle';
    if (has('happy')) return 'happy';
    return Object.keys(states).find((k) => has(k) && k !== 'dormant') ?? 'idle';
  }, [transientMood, profile?.mood, outfit]); // eslint-disable-line react-hooks/exhaustive-deps

  let state = restState;
  if (forceState && has(forceState)) state = forceState;
  else if (status.speaking && has('talk')) state = 'talk';
  else if (status.listening && has('listen')) state = 'listen';
  else if (status.thinking && has('think')) state = 'think';

  const fps = Math.max(1, profile?.layout.fps ?? 8);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 1000 / fps);
    return () => window.clearInterval(t);
  }, [fps]);

  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        setBlinking(true);
        window.setTimeout(() => setBlinking(false), Math.max(120, (states.blink?.length ?? 1) * 70));
        loop();
      }, 2800 + Math.random() * 3600);
    };
    loop();
    return () => window.clearTimeout(t);
  }, [outfit]); // eslint-disable-line react-hooks/exhaustive-deps

  const [mouth, setMouth] = useState(0);
  useEffect(() => {
    if (!status.speaking) {
      setMouth(0);
      return;
    }
    let raf = 0;
    let last = -1;
    const n = states.talk?.length ?? 0;
    const loop = () => {
      const lv = getVoiceLevel();
      const idx = n <= 1 ? (lv > 0.12 ? 1 : 0) : Math.min(n - 1, Math.floor(lv * n * 1.4));
      if (idx !== last) {
        last = idx;
        setMouth(idx);
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [status.speaking, outfit]); // eslint-disable-line react-hooks/exhaustive-deps

  let frame: string | undefined;
  const restFrames = states[restState] ?? [];
  if (state === 'talk') {
    const talk = states.talk;
    // un video "talk" va in loop così com'è; con frame statici si fa lip sync
    if (talk.length === 1 && isAnimated(talk[0])) frame = talk[0];
    else frame = talk.length === 1 ? (mouth ? talk[0] : restFrames[0] ?? talk[0]) : talk[mouth];
  } else if (blinking && has('blink') && state === restState) {
    frame = states.blink[Math.min(states.blink.length - 1, tick % states.blink.length)];
  } else {
    const f = states[state] ?? [];
    // i video non si alternano a ogni tick: si usa il primo
    frame = f.length ? (isVideo(f[0]) ? f[0] : f[tick % f.length]) : undefined;
  }

  return { frame, state, anyFrames, has };
}
