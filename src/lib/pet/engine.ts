/**
 * Motore del desktop pet: fisica, sedute sulle finestre, comportamenti autonomi e disegno su canvas.
 *
 * Unisce i due progetti originali:
 * - lachydotmcg/capri-desktop (PolyForm Noncommercial 1.0.0, © 2026 Lachy): animazioni a strisce con blink/glitch
 *   inseriti nel ciclo, trascinamento "dangle", caduta con gravità, seduta sui bordi delle finestre che la segue,
 *   si alza se la finestra viene coperta, Shift = siediti qui, Ctrl = resta appesa, sale sul cursore.
 * - notme71/Capri-Desktop (MIT, © 2026 vincent): stretch / look / yawn / pat / sleep / peek / sit con easing
 *   (smoothstep + envelope), fantasmi rosso/verde durante il glitch, z e cuori, salto ad arco sulle finestre.
 *
 * Migliorie: lancio con inerzia (rimbalza sui bordi e atterra sul primo bordo che attraversa), dopo che la finestra
 * sparisce cade sul bordo successivo invece di restare sospesa, zona cliccabile aderente al frame, dondolio a ritmo
 * quando suona la musica, tutto nello stesso overlay Tauri (niente finestre extra).
 */
import type { Ledge, PetWin, DeskInfo, Area } from './desk';
import { covered, findLedges, ledgeBelow } from './desk';
import type { LoadedPack, Sheet } from './pack';

export const SIT_X = 0.3;
export const SIT_Y = 0.79;
export const PERCH_LEFT = 0.21;
export const PERCH_TOP = 0.17;
export const PERCH_RIGHT = 0.69;
const BLINK_FROM = 9;

export const ease = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
export const envelope = (age: number, len: number, fade: number) => ease(age / fade) * ease((len - age) / fade);

export type Behavior = 'none' | 'stretch' | 'look' | 'yawn' | 'sleep' | 'pat' | 'glitch';
export type PetState = 'idle' | 'perch' | 'fall' | 'drag' | 'hang' | 'ride' | 'hop' | 'peek';

const LENGTH: Record<Behavior, number> = { none: 0, stretch: 2.6, look: 3.0, yawn: 2.4, sleep: 0, pat: 2.8, glitch: 3.2 };

/** Generatore pseudo-casuale deterministico per frame (jitter stabile per 80 ms, come in Capri-Desktop). */
function jitter(seed: number) {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export interface Frame {
  /** rettangolo cliccabile (CSS) */
  hit: { x: number; y: number; w: number; h: number } | null;
  /** testa (per fumetti) */
  head: { x: number; y: number };
  /** box della figura e trasformazione (per il ripiego con le GIF del profilo) */
  body: { x: number; y: number; w: number; h: number; rot: number; sx: number; sy: number };
}

export interface EngineHooks {
  now: () => number;
  /** parla/reagisce (battute) */
  onEvent: (e: 'land' | 'grab' | 'click' | 'wake' | 'sleep' | 'pat' | 'peek' | 'sit' | 'stretch' | 'look' | 'yawn' | 'standup' | 'hopoff' | 'glitch-end', data?: unknown) => void;
  save: (x: number, y: number) => void;
}

export class PetEngine {
  S = 240;
  ax = 0;
  ay = 0;
  state: PetState = 'fall';
  seat: Ledge | null = null;
  free = false;
  // caduta
  vx = 0;
  vy = 0;
  fallLimited: Ledge | null = null;
  lastStep = 0;
  lastTick = 0;
  // salto ad arco
  hop: { fx: number; fy: number; tx: number; ty: number; t0: number; dur: number; ledge: Ledge } | null = null;
  // peek
  peek: { edge: 0 | 1 | 2; home: { x: number; y: number }; stage: 0 | 1 | 2 | 3; t: number; slide: number; out: number } | null = null;
  // animazione a strisce
  clip = 'idle';
  clipStart = 0;
  idleCycle = 0;
  blinkWith: string | null = null;
  nextGlitch = 0;
  // comportamenti
  behavior: Behavior = 'none';
  bStart = 0;
  sleepAmount = 0;
  sleepKey: 'sleep' | 'laying' = 'sleep';
  followWithSleep = false;
  untilTouched = false;
  reactionStart = -10;
  lean = 0;
  mirror = 1;
  // ride
  ride = { x: 0, y: 0, vx: 0 };
  // desktop
  wins: PetWin[] = [];
  ledges: Ledge[] = [];
  desk: DeskInfo | null = null;
  coveredSince = -1;
  seatLost = -1;
  music = false;
  motion = true;
  talking = false;
  voice = 0;
  hidden = false;
  /** posizionata (prima posizione nota) */
  ready = false;

  constructor(
    public pack: LoadedPack,
    private hooks: EngineHooks,
  ) {
    const t = hooks.now();
    this.clipStart = t;
    this.lastStep = t;
    this.nextGlitch = t + 30 + Math.random() * 30;
  }

  get hasStrips() {
    return !!(this.pack.strips.idle && this.pack.strips.dangle && this.pack.strips.perch);
  }
  get hasPoses() {
    return !!this.pack.poses.base;
  }

  get work(): Area {
    return this.desk?.work ?? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight - 48 };
  }

  hip() {
    return { x: this.ax + this.S * SIT_X, y: this.ay + this.S * SIT_Y };
  }
  seated(x: number, y: number) {
    this.ax = x - this.S * SIT_X;
    this.ay = y - this.S * SIT_Y;
  }
  centre() {
    return { x: this.ax + this.S / 2, y: this.ay + this.S / 2 };
  }
  get headroom() {
    return this.S * (SIT_Y - PERCH_TOP);
  }

  setWindows(wins: PetWin[], desk: DeskInfo) {
    this.wins = wins;
    this.desk = desk;
    this.ledges = findLedges(wins, desk.work);
  }

  play(clip: string) {
    this.clip = clip;
    this.clipStart = this.hooks.now();
    this.idleCycle = 0;
    this.blinkWith = null;
  }

  // ------------------------------------------------------------ posizionamento

  place(x: number, y: number, placed: boolean) {
    this.ready = true;
    const w = this.work;
    if (placed && x > w.x - this.S && x < w.x + w.w && y > w.y - this.S && y < w.y + w.h) {
      this.ax = x;
      this.ay = y;
    } else {
      this.ax = w.x + w.w - this.S * PERCH_RIGHT - 40;
      this.ay = w.y;
    }
    this.fall();
  }

  /** Riporta Capri al centro in alto e la fa cadere. */
  summon() {
    const w = this.work;
    this.stopBehavior();
    this.peek = null;
    this.ax = w.x + w.w / 2 - this.S / 2;
    this.ay = w.y;
    this.fall();
  }

  resize(size: number) {
    const hip = this.hip();
    const c = this.centre();
    this.S = size;
    if (this.seat) this.seated(hip.x, this.seat.y);
    else {
      this.ax = c.x - size / 2;
      this.ay = c.y - size / 2;
    }
  }

  // ------------------------------------------------------------ fisica

  fall(vx = 0, vy = 0) {
    this.seat = null;
    this.free = false;
    this.hop = null;
    this.fallLimited = null;
    this.state = 'fall';
    this.vx = vx;
    this.vy = vy;
    this.lastStep = this.hooks.now();
    this.play('dangle');
  }

  private tumble(now: number) {
    const dt = Math.max(0, Math.min(0.05, now - this.lastStep));
    this.lastStep = now;
    const w = this.work;
    const before = this.hip();
    this.vy += this.S * 11 * dt;
    this.ax += this.vx * dt;
    this.ay += this.vy * dt;
    this.vx *= Math.pow(0.4, dt);
    // rimbalzo sui lati dello schermo
    const minX = w.x - this.S * SIT_X + 8;
    const maxX = w.x + w.w - this.S * SIT_X - 8;
    if (this.ax < minX) {
      this.ax = minX;
      this.vx = Math.abs(this.vx) * 0.45;
    } else if (this.ax > maxX) {
      this.ax = maxX;
      this.vx = -Math.abs(this.vx) * 0.45;
    }
    if (this.ay < w.y - this.S * 0.4 && this.vy < 0) {
      this.ay = w.y - this.S * 0.4;
      this.vy = 0;
    }
    const hip = this.hip();
    if (this.vy <= 0) return;
    // primo bordo attraversato in questo passo
    let hit: Ledge | null = null;
    const pool = this.fallLimited ? [this.fallLimited, ...this.ledges.filter((l) => l.floor)] : this.ledges;
    for (const l of pool) {
      if (l.y < before.y - 1 || l.y > hip.y) continue;
      if (hip.x < l.left - 8 || hip.x > l.right + 8 || l.right - l.left < 24) continue;
      if (!l.floor && l.y - this.headroom < w.y) continue;
      if (!hit || l.y < hit.y) hit = l;
    }
    if (hit) this.land(hit);
    else if (hip.y > w.y + w.h + 2) this.land(this.ledges.find((l) => l.floor) ?? { hwnd: 0, win: null, floor: true, free: false, left: w.x, right: w.x + w.w, y: w.y + w.h });
  }

  land(ledge: Ledge) {
    if (ledge.hwnd) {
      const spot = this.wins.find((x) => x.hwnd === ledge.hwnd);
      if (!spot || !spot.seat) {
        // la finestra non c'è più: continua a cadere
        this.fallLimited = null;
        return;
      }
      ledge = { ...ledge, win: { x: spot.x, y: spot.y, w: spot.w, h: spot.h }, y: spot.y, left: Math.max(ledge.left, spot.x), right: Math.min(ledge.right, spot.x + spot.w) };
    }
    const w = this.work;
    this.state = 'perch';
    this.vx = this.vy = 0;
    this.fallLimited = null;
    this.coveredSince = this.seatLost = -1;
    let x = Math.max(ledge.left + 8, Math.min(this.hip().x, ledge.right - 8));
    const rightmost = w.x + w.w - this.S * (PERCH_RIGHT - SIT_X);
    x = Math.max(w.x + this.S * (SIT_X - PERCH_LEFT), Math.min(x, rightmost));
    this.seat = ledge;
    this.free = ledge.free;
    this.seated(x, ledge.y);
    this.play(this.pack.strips.perch_glitch ? 'perch_glitch' : 'perch');
    this.hooks.save(this.ax, this.ay);
    this.hooks.onEvent('land', ledge);
  }

  standUp(thenFall = true) {
    this.seat = null;
    this.free = false;
    this.coveredSince = this.seatLost = -1;
    this.state = 'idle';
    this.play('glitch');
    this.hooks.onEvent('standup');
    if (thenFall) {
      // miglioria: invece di restare sospesa, cade sul bordo successivo
      const hip = this.hip();
      const below = ledgeBelow(this.ledges, hip.x, hip.y + 4, 0, 1e9, 0, this.headroom, this.work.y);
      if (below) {
        this.fall();
        this.fallLimited = null;
      }
    }
  }

  private holdSeat(now: number) {
    const seat = this.seat;
    if (!seat || !seat.hwnd) return;
    const spot = this.wins.find((x) => x.hwnd === seat.hwnd);
    if (!spot || !spot.seat) {
      if (this.seatLost < 0) this.seatLost = now;
      if (now - this.seatLost >= 0.3) this.standUp();
      return;
    }
    this.seatLost = -1;
    const old = seat.win;
    if (old && old.x === spot.x && old.y === spot.y && old.w === spot.w && old.h === spot.h) return;
    const dx = old && spot.w === old.w ? spot.x - old.x : 0;
    const x = Math.max(spot.x + 8, Math.min(this.hip().x + dx, spot.x + spot.w - 8));
    this.seat = { ...seat, win: { x: spot.x, y: spot.y, w: spot.w, h: spot.h }, left: spot.x, right: spot.x + spot.w, y: spot.y };
    this.seated(x, spot.y);
  }

  private checkCovered(now: number) {
    const seat = this.seat;
    if (!seat || seat.floor || this.state !== 'perch') return;
    if (!covered(this.wins, seat, this.hip().x)) {
      this.coveredSince = -1;
      return;
    }
    if (this.coveredSince < 0) this.coveredSince = now;
    if (now - this.coveredSince >= 0.7) this.standUp();
  }

  // ------------------------------------------------------------ input

  grab() {
    this.stopBehavior(false);
    this.peek = null;
    this.hop = null;
    this.seat = null;
    this.state = 'drag';
    this.play('dangle');
    this.hooks.onEvent('grab');
  }

  dragTo(ax: number, ay: number) {
    this.ax = ax;
    this.ay = ay;
  }

  /** Rilascio: Shift = siediti qui, Ctrl = resta appesa, lancio veloce = vola, altrimenti cade sul bordo sotto (portata limitata). */
  drop(mod: { shift: boolean; ctrl: boolean }, vx: number, vy: number) {
    if (mod.ctrl) {
      this.state = 'hang';
      this.play('dangle');
      this.hooks.save(this.ax, this.ay);
      return;
    }
    if (mod.shift) {
      this.sitHere();
      return;
    }
    const speed = Math.hypot(vx, vy);
    if (speed > 650) {
      this.fall(Math.max(-2600, Math.min(2600, vx)), Math.max(-1800, Math.min(1400, vy * 0.6)));
      return;
    }
    const hip = this.hip();
    const target = ledgeBelow(this.ledges, hip.x, hip.y, Math.max(32, this.S * 0.45), Math.max(160, this.S), 24, this.headroom, this.work.y);
    if (!target) {
      this.state = 'idle';
      this.play('idle');
      this.hooks.save(this.ax, this.ay);
      return;
    }
    this.fall();
    this.fallLimited = target;
  }

  sitHere() {
    const hip = this.hip();
    this.land({ hwnd: 0, win: null, floor: true, free: true, left: hip.x - 8, right: hip.x + 8, y: hip.y });
  }

  letGo() {
    this.play('glitch');
    this.fall();
  }

  react() {
    if (this.behavior === 'sleep') {
      this.wake();
      return;
    }
    this.reactionStart = this.hooks.now();
    this.play(this.state === 'perch' || this.state === 'ride' ? 'perch_glitch' : 'glitch');
    this.hooks.onEvent('click');
  }

  // ------------------------------------------------------------ ride

  startRide(cx: number, cy: number) {
    this.stopBehavior(false);
    this.seat = null;
    this.peek = null;
    this.hop = null;
    this.state = 'ride';
    this.ride = { x: cx, y: cy, vx: 0 };
    this.play('perch_glitch');
  }

  stopRide() {
    if (this.state !== 'ride') return;
    this.lean = 0;
    this.state = 'idle';
    this.play('grin');
    this.hooks.onEvent('hopoff');
    this.fall();
  }

  rideTo(cx: number, cy: number, dt: number) {
    const vx = dt > 0 ? (cx - this.ride.x) / dt : 0;
    this.ride.vx = this.ride.vx * 0.8 + vx * 0.2;
    this.ride.x = cx;
    this.ride.y = cy;
    this.seated(cx - 2, cy + 6);
    this.lean = this.lean * 0.8 + Math.max(-14, Math.min(14, -this.ride.vx * 0.012)) * 0.2;
  }

  // ------------------------------------------------------------ comportamenti autonomi (Capri-Desktop)

  startBehavior(b: Behavior, manual = false) {
    if (this.state === 'drag' || this.state === 'ride' || this.state === 'fall' || this.state === 'hop') return false;
    if (b === 'sleep') this.sleepKey = Math.random() < 0.5 ? 'sleep' : 'laying';
    this.behavior = b;
    this.bStart = this.hooks.now();
    this.followWithSleep = false;
    this.untilTouched = manual && b === 'sleep';
    if (b === 'sleep' && this.pack.strips.sleep) this.play('sleep');
    if (b === 'glitch') this.reactionStart = this.bStart;
    if (b !== 'glitch' && b !== 'sleep' && b !== 'none') this.hooks.onEvent(b);
    if (b === 'sleep') this.hooks.onEvent('sleep');
    return true;
  }

  stopBehavior(goHome = true) {
    if (this.peek && goHome) {
      this.ax = this.peek.home.x;
      this.ay = this.peek.home.y;
      this.peek = null;
      if (this.state === 'peek') this.state = 'idle';
    }
    this.behavior = 'none';
    this.followWithSleep = false;
    this.sleepAmount = 0;
    this.lean = 0;
  }

  wake() {
    if (this.behavior !== 'sleep') return;
    this.behavior = 'none';
    this.untilTouched = false;
    this.play(this.pack.strips.wake ? 'wake' : 'grin');
    this.hooks.onEvent('wake');
  }

  /** Salto ad arco su un bordo (Sit di Capri-Desktop + seduta di capri-desktop). */
  hopTo(ledge: Ledge, x?: number) {
    if (this.state === 'drag' || this.state === 'ride') return false;
    this.stopBehavior(false);
    const hip = this.hip();
    const margin = this.S / 4;
    const tx = x ?? ledge.left + margin + Math.random() * Math.max(1, ledge.right - ledge.left - 2 * margin);
    this.seat = null;
    this.state = 'hop';
    this.hop = { fx: hip.x, fy: hip.y, tx: Math.max(ledge.left + 8, Math.min(tx, ledge.right - 8)), ty: ledge.y, t0: this.hooks.now(), dur: Math.min(1.4, 0.55 + Math.hypot(tx - hip.x, ledge.y - hip.y) / 1400), ledge };
    this.play('dangle');
    return true;
  }

  /** Un bordo dove sedersi diverso da quello attuale (finestre prima del pavimento). */
  pickLedge(): Ledge | null {
    const w = this.work;
    const ok = this.ledges.filter((l) => l.right - l.left >= this.S * 0.6 && l.y - this.headroom > w.y && (!this.seat || l.hwnd !== this.seat.hwnd || l.floor !== this.seat.floor));
    const wins = ok.filter((l) => !l.floor);
    const pool = wins.length && Math.random() < 0.8 ? wins : ok;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  private advanceHop(now: number) {
    const h = this.hop;
    if (!h) return;
    const p = Math.min(1, (now - h.t0) / h.dur);
    const e = ease(p);
    const x = h.fx + (h.tx - h.fx) * e;
    const apex = Math.min(h.fy, h.ty) - this.S * 0.55;
    // parabola che passa per partenza, vertice e arrivo
    const y = (1 - p) * (1 - p) * h.fy + 2 * (1 - p) * p * (2 * apex - (h.fy + h.ty) / 2) + p * p * h.ty;
    this.lean = Math.max(-12, Math.min(12, (h.tx - h.fx) * 0.02)) * Math.sin(Math.PI * p);
    this.seated(x, y);
    if (p >= 1) {
      this.hop = null;
      this.lean = 0;
      // la finestra potrebbe essersi spostata durante il salto
      const fresh = h.ledge.hwnd ? this.ledges.find((l) => l.hwnd === h.ledge.hwnd && h.tx >= l.left - 8 && h.tx <= l.right + 8) : h.ledge;
      if (fresh) {
        this.land(fresh);
        this.hooks.onEvent('sit');
      } else this.fall();
    }
  }

  /** Sbircia da un bordo dello schermo: 0 sinistra, 1 destra, 2 sotto. */
  startPeek() {
    if (this.state === 'drag' || this.state === 'ride' || this.state === 'fall' || this.state === 'hop') return false;
    const w = this.work;
    const c = this.centre();
    // il bordo più vicino
    const d = [c.x - w.x, w.x + w.w - c.x, (w.y + w.h - c.y) * 1.3];
    const edge = d.indexOf(Math.min(...d)) as 0 | 1 | 2;
    this.stopBehavior(false);
    this.seat = null;
    this.state = 'peek';
    this.peek = { edge, home: { x: this.ax, y: this.ay }, stage: 0, t: this.hooks.now(), slide: 0, out: 0 };
    this.play('idle');
    return true;
  }

  private advancePeek(now: number, dt: number) {
    const p = this.peek;
    if (!p) return;
    const w = this.work;
    if (p.stage === 0) {
      p.slide = Math.min(1, p.slide + dt / 1.3);
      if (p.slide >= 1) {
        p.stage = 1;
        p.t = now;
        this.hooks.onEvent('peek');
      }
    } else if (p.stage === 1) {
      p.out = Math.min(1, p.out + dt / 0.9);
      if (now - p.t >= 5) p.stage = 2;
    } else if (p.stage === 2) {
      p.out = Math.max(0, p.out - dt / 0.7);
      if (p.out <= 0) p.stage = 3;
    } else p.slide = Math.max(0, p.slide - dt / 1.3);
    // nascosta oltre il bordo, poi si affaccia
    const hiddenX = p.edge === 0 ? w.x - this.S * 0.95 : w.x + w.w - this.S * 0.05;
    const peekX = p.edge === 0 ? w.x - this.S * 0.42 : w.x + w.w - this.S * 0.58;
    const hiddenY = w.y + w.h + this.S * 0.05;
    const peekY = w.y + w.h - this.S * 0.55;
    const along = ease(p.slide);
    const reach = ease(p.out);
    if (p.edge === 2) {
      this.ax = p.home.x;
      const ty = hiddenY + (peekY - hiddenY) * reach;
      this.ay = p.home.y + (ty - p.home.y) * along;
    } else {
      const tx = hiddenX + (peekX - hiddenX) * reach;
      this.ax = p.home.x + (tx - p.home.x) * along;
      this.ay = p.home.y;
    }
    this.mirror = p.edge === 0 ? -1 : 1;
    this.lean = (p.edge === 2 ? 0 : p.edge === 1 ? -10 : 10) * reach + Math.sin(now * 1.7) * 2 * reach;
    if (p.stage === 3 && p.slide <= 0) {
      this.ax = p.home.x;
      this.ay = p.home.y;
      this.peek = null;
      this.lean = 0;
      this.mirror = 1;
      this.state = 'idle';
      this.fall();
    }
  }

  // ------------------------------------------------------------ passo

  /** Avanza la simulazione. Ritorna true se c'è stato movimento (serve aggiornare la finestra). */
  step() {
    const now = this.hooks.now();
    const dt = this.lastTick ? Math.min(0.1, Math.max(0, now - this.lastTick)) : 0;
    this.lastTick = now;
    if (this.state === 'fall') this.tumble(now);
    else if (this.state === 'perch') {
      this.holdSeat(now);
      this.checkCovered(now);
    } else if (this.state === 'hop') this.advanceHop(now);
    else if (this.state === 'peek') this.advancePeek(now, dt);

    // sonno con dissolvenza
    this.sleepAmount += ((this.behavior === 'sleep' ? 1 : 0) - this.sleepAmount) * 0.07;
    if (this.behavior !== 'sleep' && this.sleepAmount < 0.005) this.sleepAmount = 0;
    if (this.behavior !== 'none' && this.behavior !== 'sleep' && now - this.bStart >= LENGTH[this.behavior]) {
      const done = this.behavior;
      this.behavior = 'none';
      if (done === 'glitch') this.hooks.onEvent('glitch-end');
      if (this.followWithSleep) this.startBehavior('sleep');
    }
  }

  // ------------------------------------------------------------ disegno

  private pose(age: number): { a: number; x: number; y: number } {
    let a = 0,
      x = 1,
      y = 1;
    const len = LENGTH[this.behavior];
    switch (this.behavior) {
      case 'stretch': {
        const r = envelope(age, len, 0.8);
        y = 1 + 0.085 * r;
        x = 1 - 0.035 * r;
        a = -3.5 * r + Math.sin(age * 16) * 0.5 * r * r;
        break;
      }
      case 'look': {
        const turn = ease((age - 0.3) / 0.45) - ease((age - 2.0) / 0.45);
        x = Math.cos(Math.PI * turn);
        a = Math.sin(age * 2.4) * 2.5 * envelope(age, len, 0.5) + 3 * turn;
        break;
      }
      case 'yawn': {
        const inhale = ease(age / 1.2) - ease((age - 1.2) / 0.5);
        const sag = ease((age - 1.2) / 0.3) * ease((len - age) / 0.7);
        y = 1 + 0.06 * inhale - 0.03 * sag;
        x = 1 - 0.015 * inhale;
        a = 2 * sag;
        break;
      }
      case 'pat': {
        const g = envelope(age, len, 0.35);
        y = 1 - 0.03 * g + Math.sin(age * 14) * 0.012 * g;
        x = 1 + 0.02 * g;
        a = Math.sin(age * 7) * 3.5 * g;
        break;
      }
      case 'glitch': {
        const s = envelope(age, len, 0.3);
        const r = jitter(Math.floor(age / 0.08) * 31 + 7);
        a = (r() - 0.5) * 4 * s;
        x = 1 + (r() - 0.5) * 0.05 * s;
        break;
      }
    }
    // con le strisce il sonno ha già la sua animazione
    if (!this.pack.strips.sleep) {
      y -= 0.045 * this.sleepAmount;
      a += 7 * this.sleepAmount;
    }
    return { a, x, y };
  }

  /** Posa singola sostituita alla figura base (cross-fade come PoseSprite di Capri-Desktop). */
  private poseSprite(now: number): { key: string; mix: number } {
    const age = now - this.bStart;
    const len = LENGTH[this.behavior];
    switch (this.behavior) {
      case 'stretch':
        return { key: 'arms', mix: envelope(age, len, 0.35) };
      case 'pat':
        return { key: this.hasStrips ? 'happyface' : 'happy', mix: envelope(age, len, 0.3) };
      case 'yawn':
        return { key: 'mouth', mix: ease((age - 0.5) / 0.4) * ease((len - 0.4 - age) / 0.4) };
      case 'look': {
        const turn = ease((age - 0.3) / 0.45) - ease((age - 2.0) / 0.45);
        return { key: 'eyes-left', mix: turn * 0.999 };
      }
      default:
        return this.sleepAmount > 0.02 && !this.pack.strips.sleep ? { key: this.sleepKey, mix: ease(this.sleepAmount) } : { key: '', mix: 0 };
    }
  }

  /** Sceglie la striscia e il frame correnti (Advance di Pet.cs). */
  private stripFrame(now: number): { sheet: Sheet; cell: number; name: string } | null {
    const S = this.pack.strips;
    const perched = this.state === 'perch' || this.state === 'ride';
    const dangling = this.state === 'drag' || this.state === 'fall' || this.state === 'hang' || this.state === 'hop';
    const seatedClip = this.clip === 'perch' || this.clip === 'perch_glitch';
    if (dangling && this.clip !== 'dangle') this.play('dangle');
    if (perched && !seatedClip) this.play('perch');
    if (!perched && !dangling && (seatedClip || this.clip === 'dangle')) this.play('idle');
    if (this.behavior === 'sleep' && S.sleep && this.clip !== 'sleep' && !dangling && !perched) this.play('sleep');
    if (this.behavior !== 'sleep' && this.clip === 'sleep') this.play(S.wake ? 'wake' : 'idle');
    let sheet = S[this.clip] ?? S.idle;
    if (!sheet) return null;
    let index = Math.floor((now - this.clipStart) * sheet.fps);
    if ((this.clip === 'glitch' && index >= sheet.count) || (this.clip === 'wake' && index >= sheet.count) || (this.clip === 'grin' && index >= sheet.count * 2)) {
      this.play('idle');
      sheet = S.idle;
      index = 0;
    }
    if (this.clip === 'perch_glitch' && index >= sheet.count) {
      this.play('perch');
      sheet = S.perch;
      index = 0;
    }
    if (!S[this.clip]) this.clip = sheet === S.perch ? 'perch' : 'idle';
    if ((this.clip === 'idle' || this.clip === 'perch') && this.motion) {
      const cycle = Math.floor(index / sheet.count);
      if (cycle !== this.idleCycle) {
        this.idleCycle = cycle;
        const roll = Math.random();
        const p = this.clip === 'perch';
        this.blinkWith = roll < 0.1 ? (p ? 'perch_blink_glitch' : 'blink_glitch') : roll < 0.55 ? (p ? 'perch_blink' : 'blink') : null;
        if (this.blinkWith && !S[this.blinkWith]) this.blinkWith = null;
        if (now >= this.nextGlitch && !this.talking) {
          this.nextGlitch = now + 30 + Math.random() * 30;
          const g = p ? 'perch_glitch' : 'glitch';
          if (S[g]) {
            this.play(g);
            return { sheet: S[g], cell: 0, name: g };
          }
        }
      }
    } else if (!this.motion && (this.clip === 'idle' || this.clip === 'perch')) index = 0;
    let cell = index % sheet.count;
    let name = this.clip;
    if ((this.clip === 'idle' || this.clip === 'perch') && this.blinkWith) {
      const b = S[this.blinkWith];
      if (b && cell >= BLINK_FROM && cell < BLINK_FROM + b.count) {
        sheet = b;
        cell -= BLINK_FROM;
        name = this.blinkWith;
      }
    }
    return { sheet, cell, name };
  }

  private tinted(sheet: Sheet, cell: number, color: string): HTMLCanvasElement {
    const key = `${color}`;
    const c = (this.tintCache[key] ??= document.createElement('canvas'));
    c.width = sheet.fw;
    c.height = sheet.fh;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(sheet.img, cell * sheet.fw, 0, sheet.fw, sheet.fh, 0, 0, sheet.fw, sheet.fh);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    return c;
  }
  private tintCache: Record<string, HTMLCanvasElement> = {};

  /**
   * Disegna Capri su `ctx` (canvas con origine in `origin`, coordinate CSS) e ritorna zona cliccabile e testa.
   */
  draw(ctx: CanvasRenderingContext2D, origin: { x: number; y: number }, dpr: number): Frame {
    const now = this.hooks.now();
    const cw = ctx.canvas.width,
      ch = ctx.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const S = this.S;
    const c = this.centre();
    const head = { x: this.ax + S * 0.52, y: this.ay - 4 };
    const body0 = { x: c.x - S / 2, y: c.y - S / 2, w: S, h: S, rot: 0, sx: 1, sy: 1 };
    if (this.hidden) return { hit: null, head, body: body0 };
    ctx.setTransform(dpr, 0, 0, dpr, -origin.x * dpr, -origin.y * dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const settled = this.state !== 'drag' && this.state !== 'fall' && this.state !== 'hop' && this.motion;
    let breathe = settled ? Math.sin(now * 1.75) * 2.2 : 0;
    let tilt = settled ? Math.sin(now * 0.95) * 0.65 : 0;
    if (this.music && settled && this.behavior !== 'sleep') {
      breathe += Math.sin(now * 6.2) * 1.6;
      tilt += Math.sin(now * 3.1) * 1.0;
    }
    const rAge = now - this.reactionStart;
    const bounce = this.hasStrips ? 0 : rAge >= 0 && rAge < 0.65 ? Math.sin((rAge / 0.65) * Math.PI) * 15 : 0;
    const sway = this.state === 'drag' || this.state === 'hang' ? Math.sin(now * 3.2) * 4 : 0;
    const pose = this.state === 'idle' || this.state === 'perch' ? this.pose(now - this.bStart) : { a: 0, x: 1, y: 1 };

    let hitBox: [number, number, number, number] | null = null;
    let rect = { x: c.x - S / 2, y: c.y - S / 2, w: S, h: S };

    ctx.save();
    ctx.translate(c.x, c.y - bounce + breathe);
    ctx.rotate(((tilt * (1 - this.sleepAmount) + this.lean + sway) * Math.PI) / 180);
    const feet = (S * 1.11) / 2 * 0.99;
    ctx.translate(0, feet);
    ctx.rotate((pose.a * Math.PI) / 180);
    ctx.scale(pose.x * this.mirror, pose.y);
    ctx.translate(0, -feet);

    if (this.hasStrips) {
      const f = this.stripFrame(now);
      if (f) {
        const tall = S * f.sheet.height;
        const wide = (tall * f.sheet.fw) / f.sheet.fh;
        rect = { x: -wide / 2, y: -tall / 2, w: wide, h: tall };
        const ps = this.behavior !== 'none' && this.behavior !== 'glitch' && this.state === 'idle' ? this.poseSprite(now) : { key: '', mix: 0 };
        const alt = ps.mix > 0.01 ? this.pack.poses[ps.key] : undefined;
        if (this.behavior === 'glitch') this.ghosts(ctx, f.sheet, f.cell, rect, now - this.bStart);
        ctx.globalAlpha = alt ? 1 - ps.mix : 1;
        ctx.drawImage(f.sheet.img, f.cell * f.sheet.fw, 0, f.sheet.fw, f.sheet.fh, rect.x, rect.y, rect.w, rect.h);
        // bocca che si muove mentre parla (solo in piedi, non durante il blink glitch)
        const mouth = this.pack.strips.mouth;
        if (this.talking && mouth && f.name === 'idle') {
          const cell = Math.min(mouth.count - 1, Math.floor(this.voice * mouth.count * 1.4));
          ctx.drawImage(mouth.img, cell * mouth.fw, 0, mouth.fw, mouth.fh, rect.x, rect.y, rect.w, rect.h);
        }
        ctx.globalAlpha = 1;
        if (alt) {
          const r2 = this.spriteRect(alt, tall);
          ctx.globalAlpha = ps.mix;
          ctx.drawImage(alt.img, r2.x, r2.y, r2.w, r2.h);
          ctx.globalAlpha = 1;
        }
        hitBox = f.sheet.boxes[f.cell] ?? null;
      }
    } else if (this.hasPoses) {
      const P = this.pack.poses;
      const perched = (this.state === 'perch' || this.state === 'ride') && P.perch;
      const base = perched ? P.perch : P.base;
      const height = (S * base.fh) / base.fw;
      rect = { x: -S / 2, y: -height / 2, w: S, h: height };
      if (this.state === 'peek' && P.lean && this.peek && this.peek.edge !== 2) {
        const r2 = this.spriteRect(P.lean, height);
        ctx.drawImage(P.lean.img, r2.x, r2.y, r2.w, r2.h);
        rect = r2;
        hitBox = P.lean.boxes[0];
      } else {
        const ps = this.state === 'idle' ? this.poseSprite(now) : { key: '', mix: 0 };
        const alt = ps.mix > 0.01 ? P[ps.key] : undefined;
        if (this.behavior === 'glitch') this.ghosts(ctx, base, 0, rect, now - this.bStart);
        ctx.globalAlpha = alt ? 1 - ps.mix : 1;
        ctx.drawImage(base.img, rect.x, rect.y, rect.w, rect.h);
        ctx.globalAlpha = 1;
        if (alt) {
          const r2 = this.spriteRect(alt, height);
          ctx.globalAlpha = ps.mix;
          ctx.drawImage(alt.img, r2.x, r2.y, r2.w, r2.h);
          ctx.globalAlpha = 1;
        }
        hitBox = base.boxes[0];
      }
    }
    ctx.restore();

    // segni: z quando dorme, cuori durante le carezze
    if (this.sleepAmount > 0.05) this.marks(ctx, 'z', '#a7f558', this.sleepAmount, now, 1, 0.1);
    if (this.behavior === 'pat') this.marks(ctx, '♥', '#ef3a4e', envelope(now - this.bStart, LENGTH.pat, 0.4), now - this.bStart, 0, 0.18);

    // zona cliccabile (ignora la rotazione: è piccola)
    let hit: Frame['hit'] = null;
    const bx = c.x + rect.x,
      by = c.y + rect.y + breathe - bounce;
    if (hitBox) {
      const [x0, y0, x1, y1] = hitBox;
      const mx = this.mirror < 0 ? 1 - x1 : x0;
      const mx1 = this.mirror < 0 ? 1 - x0 : x1;
      hit = { x: bx + mx * rect.w, y: by + y0 * rect.h, w: (mx1 - mx) * rect.w, h: (y1 - y0) * rect.h };
    } else hit = { x: bx + rect.w * 0.2, y: by, w: rect.w * 0.6, h: rect.h };
    const body = { x: c.x - S / 2, y: c.y - S / 2 + breathe - bounce, w: S, h: S, rot: tilt * (1 - this.sleepAmount) + this.lean + sway + pose.a, sx: pose.x * this.mirror, sy: pose.y };
    return { hit, head: { x: hit.x + hit.w * 0.5, y: hit.y - 4 }, body };
  }

  /** Rettangolo di una posa singola dentro un box un po' più grande della figura base (SpriteRect). */
  private spriteRect(s: Sheet, baseHeight: number) {
    const box = this.S * 1.1;
    const scale = Math.min(box / s.fw, box / s.fh);
    const w = s.fw * scale;
    const h = s.fh * scale;
    const top = s.fw < s.fh * 0.8 ? baseHeight / 2 - h : -h / 2;
    return { x: -w / 2, y: top, w, h };
  }

  private ghosts(ctx: CanvasRenderingContext2D, sheet: Sheet, cell: number, rect: { x: number; y: number; w: number; h: number }, age: number) {
    const surge = envelope(age, LENGTH.glitch, 0.3);
    const r = jitter(Math.floor(age / 0.08) * 17 + 3);
    const reach = ((3 + r() * 7) * surge * this.S) / 240;
    ctx.globalAlpha = 0.6 * surge;
    ctx.drawImage(this.tinted(sheet, cell, 'rgb(239,40,64)'), rect.x - reach, rect.y, rect.w, rect.h);
    ctx.drawImage(this.tinted(sheet, cell, 'rgb(60,255,110)'), rect.x + reach, rect.y + (r() - 0.5) * 4, rect.w, rect.h);
    ctx.globalAlpha = 1;
  }

  private marks(ctx: CanvasRenderingContext2D, glyph: string, color: string, amount: number, time: number, side: number, rise: number) {
    const u = this.S;
    const c = this.centre();
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      const phase = (time / 3.2 + i / 3) % 1;
      const fade = Math.sin(Math.PI * phase) * amount;
      const lean = side !== 0 ? side : i % 2 === 0 ? -1 : 1;
      const x = c.x + lean * u * (0.27 + 0.05 * Math.sin(phase * 6.28));
      const y = c.y - u * (rise + 0.33 * phase);
      ctx.font = `bold ${glyph === 'z' ? 'italic ' : ''}${Math.round(u * (0.06 + 0.07 * phase))}px 'Segoe UI', sans-serif`;
      ctx.strokeStyle = `rgba(26,27,31,${0.6 * fade})`;
      ctx.fillStyle = color;
      ctx.globalAlpha = Math.max(0, Math.min(1, fade * 0.92));
      ctx.strokeText(glyph, x, y);
      ctx.fillText(glyph, x, y);
    }
    ctx.restore();
  }
}
