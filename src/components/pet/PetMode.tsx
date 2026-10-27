/**
 * MODALITÀ DESKTOP PET
 * Capri vive sul desktop in autonomia: si siede sui bordi delle finestre e le segue, cade, si lascia trascinare
 * e lanciare, sale sul cursore, sbircia dai bordi, si stiracchia, sbadiglia, si addormenta, fa dispetti (mischief),
 * commenta da sola e chiacchiera con l'AI dell'app. Porting e unione di:
 *   lachydotmcg/capri-desktop (PolyForm Noncommercial 1.0.0) e notme71/Capri-Desktop (MIT).
 */
import { invoke } from '@tauri-apps/api/core';
import { type PointerEvent as RPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { setInteractive, useHitRef } from '../../lib/hit';
import { usePet } from '../../lib/pet/bus';
import { getDesk, getWindows, type DeskInfo } from '../../lib/pet/desk';
import { PetEngine, type Frame } from '../../lib/pet/engine';
import { addSync, observe, petSay, pickMischiefKind, refreshVoiceLines, studying, voiceOnly } from '../../lib/pet/life';
import { L, pick } from '../../lib/pet/lines';
import { loadPacks, type LoadedPack } from '../../lib/pet/pack';
import { activeProfile, useApp } from '../../lib/store';
import { getVoiceLevel } from '../../lib/tts';
import { useSpriteFrame } from '../../lib/useSprite';
import { SpriteMedia } from '../SpriteMedia';
import { CutIn, MISCHIEF_SECONDS, MischiefOverlay } from './Mischief';
import { PetBubble, PetPill, PetTyper } from './PetBubble';
import { PetMenu } from './PetMenu';

const now = () => performance.now() / 1000;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function PetMode({ onListen }: { onListen: () => void }) {
  const pet = useApp((s) => s.settings.pet);
  const balloon = useApp((s) => s.balloon);
  const profile = useApp((s) => s.profiles.find((p) => p.id === s.settings.activeProfileId) ?? s.profiles[0]);
  const [pack, setPack] = useState<LoadedPack | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState(false);
  const [pill, setPill] = useState({ x: 0, y: 0 });
  const [fallback, setFallback] = useState(false);
  const [engineState, setEngineState] = useState({ state: 'fall', sleeping: false });
  const engine = useRef<PetEngine | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hitEl = useRef<HTMLDivElement | null>(null);
  const fbEl = useRef<HTMLDivElement>(null);
  const hitRef = useHitRef('pet-body');
  const desk = useRef<DeskInfo | null>(null);
  const menuOpen = useRef(false);
  menuOpen.current = !!menu;
  const { frame: profFrame } = useSpriteFrame(profile);

  // ---------------------------------------------------------- pacchetti di sprite
  useEffect(() => {
    let alive = true;
    void loadPacks().then((all) => {
      if (!alive) return;
      const mode = useApp.getState().settings.pet.pack;
      const view: LoadedPack = {
        strips: mode === 'auto' || mode === 'strips' ? all.strips : {},
        poses: mode === 'profile' ? {} : all.poses,
      };
      const usable = !!(view.strips.idle && view.strips.dangle && view.strips.perch) || (mode !== 'strips' && !!view.poses.base);
      setFallback(!usable);
      setPack(view);
    });
    void refreshVoiceLines();
    return () => {
      alive = false;
    };
  }, [pet.pack, pet.files]);

  // ---------------------------------------------------------- motore
  const saveTimer = useRef(0);
  useEffect(() => {
    if (!pack) return;
    const e = new PetEngine(pack, {
      now,
      save: (x, y) => {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => useApp.getState().setSettings((s) => ({ ...s, pet: { ...s.pet, x, y, placed: true } })), 800);
      },
      onEvent: (ev) => {
        const st = useApp.getState();
        const quiet = st.status.speaking || st.status.thinking || !!usePet.getState().bubble;
        switch (ev) {
          case 'click':
            if (!quiet) petSay(pick('click'), { mood: 'smug', occasion: 'click', voice: false });
            break;
          case 'pat':
            addSync(3, 'pat');
            petSay(pick('pat'), { mood: 'love', occasion: 'pat' });
            break;
          case 'wake':
            if (!quiet && Math.random() < 0.6) petSay(pick('wake'), { mood: 'surprised', occasion: 'wake', voice: false });
            break;
          case 'sit':
            if (!quiet && Math.random() < 0.35) petSay(pick('sit'), { mood: 'happy', occasion: 'sit', voice: false });
            break;
          case 'peek':
            if (!quiet) petSay(pick('peek'), { mood: 'smug', occasion: 'peek', voice: false, sec: 3.5 });
            break;
          case 'hopoff':
            petSay(pick('hop'), { mood: 'smug', occasion: 'hop', voice: false, sec: 3 });
            break;
          case 'stretch':
          case 'look':
          case 'yawn':
          case 'sleep':
            voiceOnly(ev);
            break;
        }
      },
    });
    e.S = useApp.getState().settings.pet.size;
    e.motion = useApp.getState().settings.pet.motion && !reducedMotion();
    const p = useApp.getState().settings.pet;
    // prima posizione: aspetta finestre e area di lavoro, poi cade
    void (async () => {
      const d = await getDesk();
      desk.current = d;
      e.setWindows(await getWindows(), d);
      e.place(p.x, p.y, p.placed);
      if (Math.random() < 0.5) petSay(pick('hello'), { mood: 'happy', occasion: 'hello', voice: false, sec: 4 });
    })();
    engine.current = e;
    return () => {
      engine.current = null;
    };
  }, [pack]);

  // taglia e animazioni
  useEffect(() => {
    engine.current?.resize(pet.size);
  }, [pet.size]);
  useEffect(() => {
    if (engine.current) engine.current.motion = pet.motion && !reducedMotion();
  }, [pet.motion]);

  // le risposte dell'AI finiscono nel fumetto del pet
  useEffect(() => {
    if (balloon && Date.now() - balloon.ts < 3000) usePet.getState().show(balloon.text, 'say', Math.max(useApp.getState().settings.pet.bubbleSec, 2 + balloon.text.length * 0.06));
  }, [balloon?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------- loop di disegno (~30 fps)
  useEffect(() => {
    let raf = 0;
    let last = 0;
    let lastPill = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 31) return;
      last = t;
      const e = engine.current;
      const cv = canvas.current;
      if (!e || !cv || !e.ready) return;
      const st = useApp.getState();
      e.talking = st.status.speaking;
      e.voice = getVoiceLevel();
      e.music = usePet.getState().musicPlaying && st.settings.pet.musicBob;
      e.hidden = st.settings.pet.hideFullscreen && !!desk.current?.fullscreen && e.state !== 'drag';
      e.step();
      const dpr = window.devicePixelRatio || 1;
      const CW = Math.ceil(e.S * 2.4);
      if (cv.width !== Math.round(CW * dpr)) {
        cv.width = Math.round(CW * dpr);
        cv.height = Math.round(CW * dpr);
        cv.style.width = `${CW}px`;
        cv.style.height = `${CW}px`;
      }
      const c = e.centre();
      const origin = { x: Math.round(c.x - CW / 2), y: Math.round(c.y - CW / 2) };
      cv.style.transform = `translate(${origin.x}px, ${origin.y}px)`;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const f: Frame = e.draw(ctx, origin, dpr);
      // ripiego: GIF/sprite del profilo
      const fb = fbEl.current;
      if (fb) {
        fb.style.transform = `translate(${f.body.x}px, ${f.body.y}px) rotate(${f.body.rot}deg) scale(${f.body.sx}, ${f.body.sy})`;
        fb.style.width = `${f.body.w}px`;
        fb.style.height = `${f.body.h}px`;
        fb.style.opacity = e.hidden ? '0' : '1';
      }
      // zona cliccabile (niente mentre è sul cursore: i click passano)
      const h = hitEl.current;
      if (h) {
        const hit = e.state === 'ride' ? null : f.hit;
        h.style.display = hit ? 'block' : 'none';
        if (hit) {
          h.style.transform = `translate(${hit.x}px, ${hit.y}px)`;
          h.style.width = `${hit.w}px`;
          h.style.height = `${hit.h}px`;
        }
      }
      usePet.getState().setHead({ x: f.head.x, y: f.head.y, size: e.S });
      if (t - lastPill > 120 && f.hit) {
        lastPill = t;
        setPill((p) => {
          const nx = Math.round(f.hit!.x + f.hit!.w + 6);
          const ny = Math.round(f.hit!.y + f.hit!.h * 0.25);
          return Math.abs(p.x - nx) > 1 || Math.abs(p.y - ny) > 1 ? { x: nx, y: ny } : p;
        });
        setEngineState((s) => (s.state !== e.state || s.sleeping !== (e.behavior === 'sleep') ? { state: e.state, sleeping: e.behavior === 'sleep' } : s));
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------------------------------------------------------- finestre, area di lavoro, segnali
  useEffect(() => {
    let alive = true;
    let lastWin = 0;
    let lastTrack = '';
    let notPlayingSince = 0;
    const poll = async () => {
      const e = engine.current;
      if (!e || !alive) return;
      const d = await getDesk();
      desk.current = d;
      e.desk = d;
      const t = now();
      const fast = e.state === 'fall' || e.state === 'perch' || e.state === 'hop' || e.state === 'drag';
      if (t - lastWin >= (fast ? 0.3 : 1.2)) {
        lastWin = t;
        const wins = await getWindows();
        e.setWindows(wins, d);
        // musica: titolo della finestra di Spotify ("Artista - Brano" mentre suona)
        const sp = wins.find((w) => w.exe === 'spotify.exe' && / - /.test(w.title));
        const yt = wins.find((w) => / - YouTube/.test(w.title) && /chrome|msedge|firefox|brave|opera/.test(w.exe));
        const track = sp?.title ?? '';
        const playing = !!sp || !!yt;
        usePet.getState().setMusic(playing);
        if (!sp) notPlayingSince ||= t;
        if (track && track !== lastTrack && (lastTrack !== '' || t - notPlayingSince >= 10)) {
          lastTrack = track;
          notPlayingSince = 0;
          if (useApp.getState().settings.pet.musicComments && !usePet.getState().bubble && e.behavior !== 'sleep') {
            usePet.getState().show(track, 'np', 4);
            window.setTimeout(() => {
              if (!usePet.getState().bubble && Math.random() < 0.5) petSay(pick('music'), { mood: 'happy', occasion: 'music', voice: false, sec: 3 });
            }, 4500);
          }
        }
      }
      const busy = e.state === 'drag' || e.state === 'ride' || e.state === 'fall' || e.state === 'hop' || e.state === 'peek' || e.behavior !== 'none' || menuOpen.current || usePet.getState().typer || useApp.getState().status.thinking || useApp.getState().status.speaking;
      observe(d, busy);
    };
    const id = window.setInterval(() => void poll().catch(() => undefined), 250);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // cursore a 30 Hz mentre ci sta sopra
  useEffect(() => {
    const id = window.setInterval(() => {
      const e = engine.current;
      if (!e || e.state !== 'ride') return;
      const t0 = now();
      void invoke<DeskInfo>('pet_desk')
        .then((d) => {
          const e2 = engine.current;
          if (e2 && e2.state === 'ride' && d.cursor_x >= -1e5) e2.rideTo(d.cursor_x, d.cursor_y, Math.max(0.016, now() - t0 + 0.033));
        })
        .catch(() => undefined);
    }, 33);
    return () => window.clearInterval(id);
  }, []);

  // ---------------------------------------------------------- vita autonoma
  const startMischief = useCallback((manual: boolean) => {
    const e = engine.current;
    if (!e) return;
    const st = useApp.getState().settings.pet;
    if (!e.startBehavior('glitch', manual)) return;
    const kind = pickMischiefKind();
    const sec = MISCHIEF_SECONDS[kind];
    if (st.motion && !reducedMotion()) usePet.getState().setMischief(kind, sec);
    if (Math.random() < 0.5) usePet.getState().setCutin(Math.random() < 0.5 ? 'eyes-glitch' : 'eyes-many', Math.min(3, sec));
    petSay(pick('hack'), { kind: 'hack', sec: sec + 1.5 });
    voiceOnly('mischief');
  }, []);

  useEffect(() => {
    const T = now();
    const sched = { nextIdle: T + 25 + Math.random() * 35, nextSit: T + 40 + Math.random() * 60, nextMischief: T + 0, lastPeekIdle: 0, perchedSince: T };
    const p0 = useApp.getState().settings.pet;
    sched.nextMischief = T + p0.mischiefMinSec + Math.random() * Math.max(0, p0.mischiefMaxSec - p0.mischiefMinSec);
    const id = window.setInterval(() => {
      const e = engine.current;
      const d = desk.current;
      if (!e || !d) return;
      const p = useApp.getState().settings.pet;
      const st = useApp.getState().status;
      const t = now();
      const idle = d.idle_ms / 1000;
      if (e.state !== 'perch') sched.perchedSince = t;
      // sveglia appena l'utente torna
      if (e.behavior === 'sleep' && idle < 1.5 && !e.untilTouched) e.wake();
      if (e.hidden || menuOpen.current || usePet.getState().typer || st.speaking || st.thinking || st.listening) return;
      if (e.state === 'drag' || e.state === 'ride' || e.state === 'fall' || e.state === 'hop' || e.state === 'peek' || e.state === 'hang') return;
      if (e.behavior !== 'none') return;
      const focusing = studying();
      if (p.sleeps && !focusing && idle >= p.sleepAfterSec) {
        if (p.idleActs) {
          e.startBehavior('yawn');
          e.followWithSleep = true;
        } else e.startBehavior('sleep');
        return;
      }
      if (p.peeks && !focusing && idle >= 90 && idle < p.sleepAfterSec && sched.lastPeekIdle === 0) {
        sched.lastPeekIdle = 1;
        e.startPeek();
        return;
      }
      if (idle < 5) sched.lastPeekIdle = 0;
      // salta su un'altra finestra ogni tanto
      if ((p.wander || p.sits) && t >= sched.nextSit && (e.state === 'idle' || (e.state === 'perch' && p.wander && t - sched.perchedSince > 120))) {
        sched.nextSit = t + 90 + Math.random() * 120;
        const l = e.pickLedge();
        if (l) {
          e.hopTo(l);
          return;
        }
      }
      if (p.mischief && !focusing && t >= sched.nextMischief && !usePet.getState().bubble) {
        sched.nextMischief = t + p.mischiefMinSec + Math.random() * Math.max(0, p.mischiefMaxSec - p.mischiefMinSec);
        startMischief(false);
        return;
      }
      if (p.idleActs && t >= sched.nextIdle) {
        sched.nextIdle = t + 25 + Math.random() * 35;
        const opts: ('stretch' | 'look' | 'yawn')[] = e.state === 'perch' ? ['look'] : ['stretch', 'look', 'yawn'];
        e.startBehavior(opts[Math.floor(Math.random() * opts.length)]);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [startMischief]);

  // ---------------------------------------------------------- azioni richieste (menu, voce, scorciatoie)
  useEffect(() => {
    const id = window.setInterval(() => {
      const e = engine.current;
      if (!e) return;
      for (const { act, manual } of usePet.getState().take()) {
        switch (act) {
          case 'sit':
            if (e.state === 'idle' || e.state === 'hang') e.sitHere();
            else {
              const l = e.pickLedge();
              if (l) e.hopTo(l);
              else petSay(pick('noseat'), { mood: 'sad' });
            }
            break;
          case 'hopwin': {
            const l = e.pickLedge();
            if (l) e.hopTo(l);
            else petSay(pick('noseat'), { mood: 'sad' });
            break;
          }
          case 'standup':
            e.standUp();
            break;
          case 'ride': {
            const d = desk.current;
            if (d) {
              e.startRide(d.cursor_x, d.cursor_y);
              petSay(pick('ride'), { mood: 'happy', voice: false, sec: 4 });
            }
            break;
          }
          case 'hopoff':
            if (e.state === 'ride') e.stopRide();
            if (usePet.getState().mischief) usePet.getState().stopMischief();
            if (e.state === 'hang') e.letGo();
            break;
          case 'summon':
            if (e.state === 'ride') e.stopRide();
            e.summon();
            break;
          case 'peek':
            e.startPeek();
            break;
          case 'sleep':
            e.startBehavior('sleep', manual);
            break;
          case 'wake':
            e.wake();
            break;
          case 'glitch':
            startMischief(manual);
            break;
          case 'grin':
            if (e.state === 'idle') e.play('grin');
            else e.reactionStart = now();
            break;
          case 'letgo':
            e.letGo();
            break;
          case 'hang':
            e.state = 'hang';
            break;
          default:
            e.startBehavior(act, manual);
        }
      }
    }, 60);
    return () => window.clearInterval(id);
  }, [startMischief]);

  // ---------------------------------------------------------- mouse: trascina, lancia, clic, doppio clic, carezze
  const press = useRef<{ x: number; y: number; ax: number; ay: number; dragging: boolean; samples: { x: number; y: number; t: number }[] } | null>(null);
  const clickTimer = useRef(0);
  const lastClick = useRef({ t: 0, x: 0, y: 0 });
  const patTrail = useRef<{ d: number; t0: number; x: number; y: number }>({ d: 0, t0: 0, x: 0, y: 0 });
  const pillHide = useRef(0);

  const onPointerDown = (ev: RPointerEvent) => {
    if (ev.button !== 0) return;
    const e = engine.current;
    if (!e) return;
    setInteractive(true);
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    press.current = { x: ev.clientX, y: ev.clientY, ax: e.ax, ay: e.ay, dragging: false, samples: [{ x: ev.clientX, y: ev.clientY, t: now() }] };
  };
  const onPointerMove = (ev: RPointerEvent) => {
    const e = engine.current;
    if (!e) return;
    const p = press.current;
    if (!p) {
      // carezza: muovere il mouse avanti e indietro sopra di lei
      const tr = patTrail.current;
      const t = now();
      if (t - tr.t0 > 1.4) {
        tr.d = 0;
        tr.t0 = t;
      }
      if (tr.x) tr.d += Math.hypot(ev.clientX - tr.x, ev.clientY - tr.y);
      tr.x = ev.clientX;
      tr.y = ev.clientY;
      if (tr.d > 260 && e.behavior === 'none' && (e.state === 'idle' || e.state === 'perch')) {
        tr.d = 0;
        tr.t0 = t + 3;
        e.startBehavior('pat', true);
      }
      return;
    }
    const dx = ev.clientX - p.x;
    const dy = ev.clientY - p.y;
    if (!p.dragging && dx * dx + dy * dy < 25) return;
    if (!p.dragging) {
      p.dragging = true;
      if (e.state === 'ride') e.stopRide();
      e.grab();
      usePet.getState().hide();
    }
    e.dragTo(p.ax + dx, p.ay + dy);
    p.samples.push({ x: ev.clientX, y: ev.clientY, t: now() });
    if (p.samples.length > 8) p.samples.shift();
  };
  const onPointerUp = (ev: RPointerEvent) => {
    const e = engine.current;
    const p = press.current;
    press.current = null;
    setInteractive(useApp.getState().lockInteractive);
    if (!e || !p) return;
    if (p.dragging) {
      // velocità del lancio dagli ultimi ~80 ms
      const t = now();
      const recent = p.samples.filter((s) => t - s.t <= 0.09);
      const a = recent[0] ?? p.samples[0];
      const b = p.samples[p.samples.length - 1];
      const dt = Math.max(0.016, b.t - a.t);
      e.drop({ shift: ev.shiftKey, ctrl: ev.ctrlKey }, (b.x - a.x) / dt, (b.y - a.y) / dt);
      return;
    }
    // clic: doppio = sale sul cursore, singolo = reazione
    const t = now();
    const lc = lastClick.current;
    if (t - lc.t < 0.32 && Math.abs(ev.clientX - lc.x) < 6 && Math.abs(ev.clientY - lc.y) < 6) {
      window.clearTimeout(clickTimer.current);
      lastClick.current = { t: 0, x: 0, y: 0 };
      if (useApp.getState().settings.pet.rideCursor) {
        e.startRide(ev.clientX, ev.clientY);
        petSay(pick('ride'), { mood: 'happy', voice: false, sec: 4 });
      }
      return;
    }
    lastClick.current = { t, x: ev.clientX, y: ev.clientY };
    window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      if (e.state === 'hang') e.letGo();
      else e.react();
    }, 330);
  };

  const sleeping = engineState.sleeping;
  return (
    <div className="pointer-events-none fixed inset-0" data-noi18n="" aria-label={L('Capri, desktop pet', 'Capri, desktop pet', 'Capri, zwierzak na pulpicie')}>
      <MischiefOverlay />
      <canvas ref={canvas} className="pointer-events-none absolute top-0 left-0" style={{ zIndex: 30, willChange: 'transform' }} aria-hidden="true" />
      {fallback && profFrame && (
        <div ref={fbEl} className="pointer-events-none absolute top-0 left-0" style={{ zIndex: 30, transformOrigin: '50% 100%' }}>
          <SpriteMedia path={profFrame} alt={activeProfile()?.name ?? 'Capri'} className="h-full w-full object-contain" />
        </div>
      )}
      <div
        ref={(el) => {
          hitEl.current = el;
          hitRef(el);
        }}
        role="button"
        tabIndex={0}
        aria-label={L('Capri: trascinala, cliccala, tasto destro per il menu', 'Capri: drag her, click her, right-click for the menu', 'Capri: przeciągnij, kliknij, prawy przycisk = menu')}
        className="pointer-events-auto absolute top-0 left-0 cursor-grab active:cursor-grabbing"
        style={{ zIndex: 31, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerEnter={() => {
          window.clearTimeout(pillHide.current);
          setHover(true);
        }}
        onPointerLeave={() => {
          patTrail.current = { d: 0, t0: 0, x: 0, y: 0 };
          pillHide.current = window.setTimeout(() => setHover(false), 1800);
        }}
        onContextMenu={(ev) => {
          ev.preventDefault();
          setMenu({ x: ev.clientX, y: ev.clientY });
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') usePet.getState().setTyper(true);
          if (ev.key === 'ContextMenu') setMenu({ x: pill.x, y: pill.y });
        }}
      />
      <div className="pointer-events-auto" onPointerEnter={() => window.clearTimeout(pillHide.current)} onPointerLeave={() => (pillHide.current = window.setTimeout(() => setHover(false), 1200))}>
        <PetPill visible={hover && engineState.state !== 'drag' && engineState.state !== 'ride' && !menu} x={pill.x} y={pill.y} onListen={onListen} />
      </div>
      <PetBubble />
      <PetTyper />
      <CutIn />
      {menu && <PetMenu x={menu.x} y={menu.y} state={engineState.state} sleeping={sleeping} onClose={() => setMenu(null)} onListen={onListen} onMischief={() => startMischief(true)} />}
      {studying() && <StudyBadge />}
    </div>
  );
}

/** Piccolo indicatore del tempo di studio rimanente (in alto a destra). */
function StudyBadge() {
  const alarms = useApp((s) => s.settings.pet.alarms);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const next = alarms.filter((a) => a.kind === 'study').sort((a, b) => a.at - b.at)[0];
  if (!next) return null;
  const left = Math.max(0, Math.round((next.at - Date.now()) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  const label = next.label === 'study:focus' ? L('PAUSA', 'BREAK', 'PRZERWA') : L('STUDIO', 'FOCUS', 'NAUKA');
  return (
    <div className="pointer-events-none fixed top-3 right-3" style={{ zIndex: 35, fontFamily: "'Share Tech Mono', Consolas, monospace", fontSize: 12, color: 'rgb(0,255,110)', background: 'rgba(7,8,13,0.85)', border: '1px solid rgb(255,20,70)', padding: '3px 8px' }}>
      {label} {mm}:{ss}
    </div>
  );
}

