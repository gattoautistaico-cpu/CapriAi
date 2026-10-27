/** Stato transitorio della modalità pet: fumetti, cut-in, mischief e richieste di azione al motore. */
import { create } from 'zustand';

export type PetAct =
  | 'stretch'
  | 'look'
  | 'yawn'
  | 'sleep'
  | 'wake'
  | 'pat'
  | 'peek'
  | 'sit'
  | 'hopwin'
  | 'standup'
  | 'glitch'
  | 'ride'
  | 'hopoff'
  | 'summon'
  | 'grin'
  | 'hang'
  | 'letgo';

export interface PetBubble {
  text: string;
  /** say = Capri parla (ritratto), hack = terminale verde, np = "now playing" */
  kind: 'say' | 'hack' | 'np';
  ts: number;
  sec: number;
}

interface PetBus {
  bubble: PetBubble | null;
  cutin: { key: string; until: number } | null;
  mischief: { kind: number; ts: number; sec: number } | null;
  /** coda di azioni per il motore (consumate dal componente) */
  acts: { act: PetAct; manual: boolean; ts: number }[];
  typer: boolean;
  /** testa di Capri in coordinate CSS (per fumetti e cut-in) */
  head: { x: number; y: number; size: number };
  musicPlaying: boolean;
  show: (text: string, kind?: PetBubble['kind'], sec?: number) => void;
  hide: () => void;
  act: (act: PetAct, manual?: boolean) => void;
  take: () => { act: PetAct; manual: boolean; ts: number }[];
  setCutin: (key: string, sec: number) => void;
  setMischief: (kind: number, sec: number) => void;
  stopMischief: () => void;
  setTyper: (on: boolean) => void;
  setHead: (h: PetBus['head']) => void;
  setMusic: (on: boolean) => void;
}

export const usePet = create<PetBus>((set, get) => ({
  bubble: null,
  cutin: null,
  mischief: null,
  acts: [],
  typer: false,
  head: { x: -1, y: -1, size: 240 },
  musicPlaying: false,
  show: (text, kind = 'say', sec) =>
    set({ bubble: { text, kind, ts: Date.now(), sec: sec ?? Math.min(14, Math.max(3.5, 2 + text.length * 0.06)) } }),
  hide: () => set({ bubble: null }),
  act: (act, manual = true) => set({ acts: [...get().acts, { act, manual, ts: Date.now() }] }),
  take: () => {
    const a = get().acts;
    if (a.length) set({ acts: [] });
    return a;
  },
  setCutin: (key, sec) => set({ cutin: { key, until: Date.now() + sec * 1000 } }),
  setMischief: (kind, sec) => set({ mischief: { kind, ts: Date.now(), sec } }),
  stopMischief: () => set({ mischief: null }),
  setTyper: (on) => set({ typer: on }),
  setHead: (h) => {
    const o = get().head;
    if (Math.abs(o.x - h.x) > 0.5 || Math.abs(o.y - h.y) > 0.5 || o.size !== h.size) set({ head: h });
  },
  setMusic: (on) => get().musicPlaying !== on && set({ musicPlaying: on }),
}));
