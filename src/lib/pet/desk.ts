/**
 * Bordi delle finestre su cui Capri può sedersi ("ledge").
 * Porting di Perches.cs (lachydotmcg/capri-desktop, PolyForm Noncommercial 1.0.0):
 * un ledge è il tratto del bordo superiore di una finestra non coperto da finestre più in alto;
 * il "pavimento" è il fondo dell'area di lavoro (sopra la taskbar).
 */
import { invoke } from '@tauri-apps/api/core';

export interface PetWin {
  hwnd: number;
  x: number;
  y: number;
  w: number;
  h: number;
  seat: boolean;
  solid: boolean;
  max: boolean;
  title: string;
  exe: string;
}

export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeskInfo {
  work: Area;
  screen: Area;
  fullscreen: boolean;
  fg: number;
  fg_title: string;
  fg_exe: string;
  cursor_x: number;
  cursor_y: number;
  idle_ms: number;
}

export interface Ledge {
  hwnd: number;
  /** rettangolo della finestra al momento della scelta */
  win: Area | null;
  floor: boolean;
  /** "siediti qui" (punto libero, nessuna finestra) */
  free: boolean;
  left: number;
  right: number;
  y: number;
}

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function getWindows(): Promise<PetWin[]> {
  if (!inTauri) return [];
  try {
    return await invoke<PetWin[]>('pet_windows');
  } catch {
    return [];
  }
}

export async function getDesk(): Promise<DeskInfo> {
  const fallback: DeskInfo = {
    work: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight - 48 },
    screen: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
    fullscreen: false,
    fg: 0,
    fg_title: '',
    fg_exe: '',
    cursor_x: -1,
    cursor_y: -1,
    idle_ms: 0,
  };
  if (!inTauri) return fallback;
  try {
    const d = await invoke<DeskInfo>('pet_desk');
    return d.work.w > 0 ? d : { ...fallback, ...d, work: fallback.work, screen: fallback.screen };
  } catch {
    return fallback;
  }
}

/** Tratti di [left,right] alla quota y non coperti dai rettangoli `above`. */
export function openSpans(left: number, right: number, y: number, above: Area[]): [number, number][] {
  let spans: [number, number][] = [[left, right]];
  for (const c of above) {
    if (y < c.y || y >= c.y + c.h) continue;
    const next: [number, number][] = [];
    for (const [a, b] of spans) {
      if (c.x + c.w <= a || c.x >= b) {
        next.push([a, b]);
        continue;
      }
      if (c.x > a) next.push([a, c.x]);
      if (c.x + c.w < b) next.push([c.x + c.w, b]);
    }
    spans = next;
  }
  return spans;
}

export function findLedges(wins: PetWin[], work: Area): Ledge[] {
  const found: Ledge[] = [];
  const above: Area[] = [];
  for (const w of wins) {
    // solo finestre sul monitor dell'overlay
    const onScreen = w.x + w.w > work.x && w.x < work.x + work.w && w.y < work.y + work.h && w.y >= work.y - 4;
    if (w.seat && onScreen)
      for (const [a, b] of openSpans(w.x, w.x + w.w, w.y, above))
        found.push({ hwnd: w.hwnd, win: { x: w.x, y: w.y, w: w.w, h: w.h }, floor: false, free: false, left: Math.max(a, work.x), right: Math.min(b, work.x + work.w), y: w.y });
    above.push(w);
  }
  found.push({ hwnd: 0, win: null, floor: true, free: false, left: work.x, right: work.x + work.w, y: work.y + work.h });
  return found;
}

/**
 * Il ledge più vicino sotto (o appena sopra) il punto `hip`.
 * over: quanto può stare sopra; reach: quanto può stare sotto; slack: tolleranza orizzontale; room: spazio per la testa.
 */
export function ledgeBelow(ledges: Ledge[], hipX: number, hipY: number, over: number, reach: number, slack: number, room: number, top: number): Ledge | null {
  let best: Ledge | null = null;
  for (const l of ledges) {
    const drop = l.y - hipY;
    if (drop < -over || drop > reach || l.right - l.left < 24) continue;
    if (hipX < l.left - slack || hipX > l.right + slack) continue;
    if (l.y - room < top) continue;
    if (!best || Math.abs(drop) < Math.abs(best.y - hipY)) best = l;
  }
  return best;
}

/** Il punto x del ledge è coperto da un'altra finestra più in alto? */
export function covered(wins: PetWin[], seat: Ledge, x: number): boolean {
  for (const w of wins) {
    if (w.hwnd === seat.hwnd) return false;
    if (w.solid && x >= w.x && x < w.x + w.w && seat.y >= w.y && seat.y < w.y + w.h) return true;
  }
  return false;
}
