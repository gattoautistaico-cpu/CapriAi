/**
 * Visibilità dell'overlay nelle catture dello schermo (Discord, OBS, Xbox Game Bar…).
 * Di default Capri è visibile in streaming. Per i suoi screenshot (visione e OCR) la
 * finestra viene esclusa dalla cattura solo per l'istante dello scatto, così non vede sé stessa.
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { log, useApp } from './store';

let busy = 0;

async function protect(on: boolean) {
  try {
    await getCurrentWindow().setContentProtected(on);
  } catch (e) {
    log('warn', 'stream', `protezione cattura non applicata: ${String(e)}`);
  }
}

/** Applica l'impostazione "visibile in Discord/OBS". */
export function applyStreamVisibility() {
  if (busy) return;
  void protect(!useApp.getState().settings.ui.streamVisible);
}

/** Esegue `fn` (uno screenshot) con l'overlay nascosto alle catture, poi ripristina. */
export async function withOverlayHidden<T>(fn: () => Promise<T>): Promise<T> {
  if (!useApp.getState().settings.ui.streamVisible) return fn();
  busy++;
  try {
    if (busy === 1) {
      await protect(true);
      await new Promise((r) => setTimeout(r, 120)); // il compositore applica l'esclusione al frame successivo
    }
    return await fn();
  } finally {
    busy--;
    if (!busy) await protect(false);
  }
}
