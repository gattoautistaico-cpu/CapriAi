import { listen } from '@tauri-apps/api/event';
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect } from 'react';
import { Avatar } from './components/Avatar';
import { CapriOverlay } from './components/Capri';
import { ChatPanel } from './components/ChatPanel';
import { Hud } from './components/Overlay';
import { SettingsPanel } from './components/Settings';
import { ask, greet, visionTick } from './lib/brain';
import { norm, trackForeground } from './lib/actions';
import { ConfirmCall } from './components/ConfirmCall';
import { setInteractive, startHitSync } from './lib/hit';
import { ollamaVram } from './lib/router';
import { log, useApp } from './lib/store';
import { ensureWhisper, mic, transcribe } from './lib/stt';
import { autodetectTools } from './lib/tools';

/** In modalità passiva: dopo la parola di attivazione la frase successiva è il comando. */
let awaitingCommandUntil = 0;

function matchWake(heard: string, words: string): string | null {
  const h = norm(heard);
  if (!h) return null;
  for (const w0 of words.split(',')) {
    const w = norm(w0);
    if (!w) continue;
    let i = h.indexOf(w);
    let len = w.length;
    if (i < 0) {
      // tollera "ehi/hei/ok" diversi: basta l'ultima parola significativa (es. "capri")
      const key = w.split(' ').pop() ?? '';
      if (key.length >= 4) {
        i = h.indexOf(key);
        len = key.length;
      }
    }
    if (i >= 0) return h.slice(i + len).trim();
  }
  return null;
}

async function onUtterance(wav: Uint8Array) {
  const st = useApp.getState();
  const passive = st.settings.passive;
  const listeningForCommand = Date.now() < awaitingCommandUntil;
  if (!passive.on || listeningForCommand) st.setStatus({ thinking: true });
  let text = '';
  try {
    text = await transcribe(wav);
  } catch (e) {
    log('error', 'stt', String(e));
  } finally {
    useApp.getState().setStatus({ thinking: false });
  }
  if (passive.on && !listeningForCommand) {
    const cmd = matchWake(text, passive.words || 'hey capri');
    if (cmd === null) return; // frase senza parola di attivazione: ignorata
    if (cmd.length > 3) {
      await ask(cmd, { voice: true, src: 'wake' });
      return;
    }
    awaitingCommandUntil = Date.now() + 12000;
    greet(passive.greeting || 'Dimmi, choom. Di cosa hai bisogno?');
    return;
  }
  awaitingCommandUntil = 0;
  if (text) await ask(text, { voice: true });
  else if (!passive.on) useApp.getState().showBalloon('Non ho capito, choom. Riprova.', 'idle');
}

async function openMic(): Promise<boolean> {
  try {
    await mic.open(onUtterance);
    return true;
  } catch (e) {
    log('error', 'mic', `microfono non disponibile: ${String(e)}`);
    return false;
  }
}

export default function App() {
  const panel = useApp((s) => s.panel);
  const lock = useApp((s) => s.lockInteractive);
  const hotkey = useApp((s) => s.settings.hotkey);
  const passiveOn = useApp((s) => s.settings.passive.on);
  const continuous = useApp((s) => s.settings.stt.continuous) || passiveOn;
  const visionOn = useApp((s) => s.settings.vision.enabled);
  const interval = useApp((s) => s.settings.vision.intervalSec);
  const baseUrl = useApp((s) => s.settings.local.baseUrl);

  const ptt = useCallback(async (down: boolean) => {
    // push-to-talk: è sempre un comando, anche in modalità passiva
    if (down) awaitingCommandUntil = Date.now() + 30000;
    if (down && !(await openMic())) return;
    mic.pushToTalk(down);
  }, []);

  // avvio
  useEffect(() => {
    startHitSync();
    trackForeground();
    void autodetectTools().then(() => ensureWhisper());
    const st = useApp.getState();
    if (st.settings.firstRun) {
      st.setPanel('settings', 'avatar');
      st.setSettings((s) => ({ ...s, firstRun: false }));
      log('info', 'app', 'Primo avvio: importa gli sprite e configura AI locale / API.');
    }
    const un = listen<string>('tray', (e) => {
      const s = useApp.getState();
      if (e.payload === 'settings') s.setPanel('settings');
      if (e.payload === 'interact') {
        s.setLock(!s.lockInteractive);
      }
    });
    return () => {
      void un.then((f) => f());
    };
  }, []);

  // modalità interattiva totale (da tray)
  useEffect(() => setInteractive(lock), [lock]);

  // hotkey push-to-talk globale
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await unregisterAll();
        if (cancelled) return;
        await register(hotkey, (e) => {
          if (e.state === 'Pressed') void ptt(true);
          else if (e.state === 'Released') void ptt(false);
        });
        log('info', 'hotkey', `push-to-talk: ${hotkey}`);
      } catch (e) {
        log('error', 'hotkey', `registrazione ${hotkey} fallita: ${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hotkey, ptt]);

  // ascolto continuo
  useEffect(() => {
    (async () => {
      if (continuous && !(await openMic())) return;
      mic.setContinuous(continuous);
    })();
  }, [continuous]);

  // visione periodica
  useEffect(() => {
    if (!visionOn) return;
    const t = window.setInterval(() => void visionTick(), Math.max(10, interval) * 1000);
    return () => window.clearInterval(t);
  }, [visionOn, interval]);

  // VRAM (solo Ollama)
  useEffect(() => {
    const poll = async () => useApp.getState().setStatus({ vramGb: await ollamaVram(baseUrl) });
    void poll();
    const t = window.setInterval(() => void poll(), 10_000);
    return () => window.clearInterval(t);
  }, [baseUrl]);

  const mode = useApp((s) => s.settings.ui.mode);
  const listenOnce = async () => {
    awaitingCommandUntil = Date.now() + 30000;
    if (!(await openMic())) return;
    mic.listenOnce();
  };

  const toggleContinuous = () => useApp.getState().setSettings((s) => ({ ...s, stt: { ...s.stt, continuous: !s.stt.continuous } }));

  return (
    <main className="relative h-screen w-screen" aria-label="Cyber AI overlay">
      {lock && <div className="pointer-events-none absolute inset-0 border-2 border-cyan/60" aria-hidden="true" />}
      <Hud />
      {mode === 'capri' ? <CapriOverlay onListen={() => void listenOnce()} /> : <Avatar onMic={toggleContinuous} />}
      <AnimatePresence>
        {panel === 'chat' && <ChatPanel key="chat" onPtt={(d) => void ptt(d)} />}
        {panel === 'settings' && <SettingsPanel key="settings" />}
      </AnimatePresence>
      <ConfirmCall />
    </main>
  );
}
