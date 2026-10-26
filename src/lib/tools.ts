/**
 * Rileva gli strumenti installati da setup.ps1 in %LOCALAPPDATA%\CyberAI\tools
 * e compila i percorsi vuoti nelle impostazioni.
 */
import { invoke } from '@tauri-apps/api/core';
import { log, useApp } from './store';

const exists = (p: string) => invoke<boolean>('path_exists', { path: p }).catch(() => false);

async function first(paths: string[]): Promise<string> {
  for (const p of paths) if (await exists(p)) return p;
  return '';
}

export async function autodetectTools(): Promise<void> {
  let dir: string;
  try {
    dir = await invoke<string>('tools_dir');
  } catch {
    return;
  }
  const j = (...p: string[]) => [dir, ...p].join('\\');
  const s = useApp.getState().settings;
  const found = {
    whisperExe: s.stt.whisperExe || (await first([j('whisper', 'whisper-server.exe'), j('whisper', 'server.exe')])),
    whisperModel:
      s.stt.whisperModel ||
      (await first([j('models', 'ggml-small.bin'), j('models', 'ggml-medium-q5_0.bin'), j('models', 'ggml-base.bin')])),
    piperExe: s.tts.piperExe || (await first([j('piper', 'piper.exe')])),
    piperModel:
      s.tts.piperModel || (await first([j('voices', 'it_IT-paola-medium.onnx'), j('voices', 'en_US-amy-medium.onnx')])),
  };
  const changed =
    found.whisperExe !== s.stt.whisperExe ||
    found.whisperModel !== s.stt.whisperModel ||
    found.piperExe !== s.tts.piperExe ||
    found.piperModel !== s.tts.piperModel;
  if (!changed) return;
  useApp.getState().setSettings((x) => ({
    ...x,
    stt: { ...x.stt, whisperExe: found.whisperExe, whisperModel: found.whisperModel },
    tts: { ...x.tts, piperExe: found.piperExe, piperModel: found.piperModel },
  }));
  log('ok', 'setup', `strumenti locali rilevati in ${dir}`);
}
