/**
 * Instant replay di Capri: ffmpeg registra lo schermo in un buffer circolare di segmenti da 5 s
 * (encoder hardware AMD/NVIDIA/Intel se disponibile). "Clip that" unisce gli ultimi N secondi in un .mp4.
 */
import { invoke } from '@tauri-apps/api/core';
import { log, useApp } from './store';

const SEG = 5;
let probed = '';
let bufDir = '';

const exists = (p: string) => invoke<boolean>('path_exists', { path: p }).catch(() => false);

/** Percorso di ffmpeg: impostazioni → cartella tools → PATH. '' se non c'è. */
export async function findFfmpeg(): Promise<string> {
  const s = useApp.getState().settings.replay;
  if (s.ffmpeg && (await exists(s.ffmpeg))) return s.ffmpeg;
  try {
    const dir = await invoke<string>('tools_dir');
    for (const p of [`${dir}\\ffmpeg\\bin\\ffmpeg.exe`, `${dir}\\ffmpeg\\ffmpeg-master-latest-win64-gpl\\bin\\ffmpeg.exe`, `${dir}\\ffmpeg.exe`]) {
      if (await exists(p)) return p;
    }
  } catch {
    /* niente */
  }
  try {
    await invoke('replay_probe', { ffmpeg: 'ffmpeg' });
    return 'ffmpeg';
  } catch {
    return '';
  }
}

/** Scarica ffmpeg (build BtbN win64 GPL, con encoder AMF/NVENC/QSV) nella cartella tools. */
export async function downloadFfmpeg(): Promise<string> {
  const dir = await invoke<string>('tools_dir');
  const zip = `${dir}\\ffmpeg.zip`;
  await invoke('download_file', { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip', dest: zip });
  await invoke('unzip_file', { zip, dest: `${dir}\\ffmpeg` });
  const exe = `${dir}\\ffmpeg\\ffmpeg-master-latest-win64-gpl\\bin\\ffmpeg.exe`;
  useApp.getState().setSettings((x) => ({ ...x, replay: { ...x.replay, ffmpeg: exe } }));
  log('ok', 'replay', `ffmpeg installato: ${exe}`);
  return exe;
}

export async function replayRunning(): Promise<boolean> {
  return invoke<boolean>('service_running', { tag: 'replay' }).catch(() => false);
}

export async function startReplay(): Promise<void> {
  const s = useApp.getState().settings.replay;
  const ffmpeg = await findFfmpeg();
  if (!ffmpeg) throw new Error('ffmpeg non trovato: scaricalo da Impostazioni → Clip');
  const enc = s.encoder || probed || (probed = await invoke<string>('replay_probe', { ffmpeg }));
  bufDir = `${await invoke<string>('data_dir')}\\replay`;
  await invoke('ensure_dir', { path: bufDir });
  const encArgs: Record<string, string[]> = {
    h264_amf: ['-c:v', 'h264_amf', '-usage', 'lowlatency', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '24', '-qp_p', '26'],
    h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p1', '-tune', 'll', '-cq', '24'],
    h264_qsv: ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '25'],
    libx264: ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '26'],
  };
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-thread_queue_size', '512', '-f', 'gdigrab', '-framerate', String(s.fps || 30), '-draw_mouse', '1', '-i', 'desktop'];
  if (s.audio) args.push('-f', 'dshow', '-i', `audio=${s.audio}`);
  args.push('-pix_fmt', 'yuv420p', ...(encArgs[enc] ?? encArgs.libx264), '-force_key_frames', `expr:gte(t,n_forced*${SEG})`);
  if (s.audio) args.push('-c:a', 'aac', '-b:a', '160k');
  args.push('-f', 'segment', '-segment_time', String(SEG), '-segment_wrap', String(Math.ceil((s.seconds || 30) / SEG) + 3), '-reset_timestamps', '1', '-segment_format', 'mpegts', `${bufDir}\\buf%02d.ts`);
  await invoke('start_service', { tag: 'replay', exe: ffmpeg, args });
  log('ok', 'replay', `instant replay attivo (${enc}, ${s.fps} fps, ${s.seconds}s)`);
}

export async function stopReplay(): Promise<void> {
  await invoke('stop_service', { tag: 'replay' }).catch(() => undefined);
  log('info', 'replay', 'instant replay spento');
}

/** Applica l'impostazione (avvia o ferma il buffer). */
export async function applyReplay(): Promise<void> {
  const on = useApp.getState().settings.replay.enabled;
  try {
    if (on && !(await replayRunning())) await startReplay();
    if (!on && (await replayRunning())) await stopReplay();
  } catch (e) {
    log('error', 'replay', String(e instanceof Error ? e.message : e));
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Salva gli ultimi N secondi. Ritorna il nome del file. */
export async function saveReplay(): Promise<string> {
  const s = useApp.getState().settings.replay;
  if (!(await replayRunning())) throw new Error('instant replay spento');
  const ffmpeg = await findFfmpeg();
  const dir = s.dir || (await invoke<string>('default_clips_dir'));
  const d = new Date();
  const name = `Capri clip ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.mp4`;
  if (!bufDir) bufDir = `${await invoke<string>('data_dir')}\\replay`;
  await invoke<string>('replay_save', { ffmpeg, bufDir, outFile: `${dir}\\${name}`, seconds: s.seconds || 30, segSec: SEG });
  log('ok', 'replay', `salvato ${name}`);
  return name;
}

export async function openClipsFolder(): Promise<void> {
  const s = useApp.getState().settings.replay;
  const dir = s.dir || (await invoke<string>('default_clips_dir'));
  await invoke('open_path', { path: dir });
}
