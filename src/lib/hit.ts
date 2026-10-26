/**
 * Registro delle zone cliccabili dell'overlay. Il backend Rust rende la
 * finestra "click-through" ovunque tranne dentro questi rettangoli.
 */
import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';

const els = new Map<string, HTMLElement>();
let lastKey = '';

function sync() {
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  els.forEach((el) => {
    if (!el.isConnected) return;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    rects.push({ x: Math.round(r.left) - 4, y: Math.round(r.top) - 4, w: Math.round(r.width) + 8, h: Math.round(r.height) + 8 });
  });
  const key = JSON.stringify(rects);
  if (key === lastKey) return;
  lastKey = key;
  invoke('set_hit_rects', { rects }).catch(() => undefined);
}

let started = false;
export function startHitSync() {
  if (started) return;
  started = true;
  window.setInterval(sync, 100);
}

/** ref callback: <div ref={useHitRef('avatar')}> */
export function useHitRef(id: string) {
  return useCallback(
    (el: HTMLElement | null) => {
      if (el) els.set(id, el);
      else els.delete(id);
    },
    [id],
  );
}

export function setInteractive(on: boolean) {
  invoke('set_interactive', { on }).catch(() => undefined);
}
