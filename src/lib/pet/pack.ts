/**
 * Pacchetti di sprite per la modalità pet.
 *
 * - "strips": animazioni a strisce di lachydotmcg/capri-desktop (idle, blink, glitch, dangle, perch, sleep, wake, grin, mouth).
 * - "poses": pose singole di notme71/Capri-Desktop (stretch, look, yawn, pat, sleep, peek, sit, ritratti, cut-in, chip).
 *
 * Le immagini sono fan art di Cyberpunk: Edgerunners (© CD PROJEKT RED / Studio Trigger): NON sono incluse
 * nel repository. Si scaricano su richiesta dagli originali (commit fissati) dentro AppData, oppure si importano
 * da una cartella locale. Senza pacchetto il pet usa gli sprite/GIF del profilo attivo.
 */
import { invoke } from '@tauri-apps/api/core';
import { log, useApp } from '../store';

export const STRIPS_REPO = 'https://raw.githubusercontent.com/lachydotmcg/capri-desktop/1165ff963e230d55704699894db8becd641f5e63/assets/sprites/';
export const POSES_REPO = 'https://raw.githubusercontent.com/notme71/Capri-Desktop/949f5bfd00d6c9de1741221cea3da6b8065bc0e0/assets/';

export interface ClipDef {
  count: number;
  fps: number;
  /** altezza rispetto alla taglia (le strisce in piedi sono un po' più alte del quadrato) */
  height: number;
}

/** Strisce orizzontali, frame affiancati (come Clip di Pet.cs). */
export const STRIPS: Record<string, ClipDef> = {
  idle: { count: 16, fps: 8, height: 1.11 },
  blink: { count: 4, fps: 8, height: 1.11 },
  blink_glitch: { count: 4, fps: 8, height: 1.11 },
  grin: { count: 16, fps: 8, height: 1.11 },
  glitch: { count: 10, fps: 15, height: 1.11 },
  dangle: { count: 24, fps: 10, height: 1.11 },
  sleep: { count: 16, fps: 6, height: 1.11 },
  wake: { count: 13, fps: 15, height: 1.11 },
  mouth: { count: 5, fps: 12, height: 1.11 },
  perch: { count: 16, fps: 8, height: 1 },
  perch_blink: { count: 4, fps: 8, height: 1 },
  perch_blink_glitch: { count: 4, fps: 8, height: 1 },
  perch_glitch: { count: 10, fps: 15, height: 1 },
};

/** Pose singole: nome → percorso nel repository. */
export const POSES: Record<string, string> = {
  base: 'capri.png',
  perch: 'perch.png',
  chip: 'chip.png',
  arms: 'art/arms.png',
  content: 'art/content.png',
  'eyes-closed': 'art/eyes-closed.png',
  'eyes-glitch': 'art/eyes-glitch.png',
  'eyes-left': 'art/eyes-left.png',
  'eyes-many': 'art/eyes-many.png',
  'eyes-right': 'art/eyes-right.png',
  eyes: 'art/eyes.png',
  happy: 'art/happy.png',
  happyface: 'art/happyface.png',
  laying: 'art/laying.png',
  lean: 'art/lean.png',
  mouth: 'art/mouth.png',
  scream: 'art/scream.png',
  sit: 'art/sit.png',
  sleep: 'art/sleep.png',
  'talk-closed': 'art/talk-closed.png',
  'talk-open': 'art/talk-open.png',
};

export type PackKind = 'strips' | 'poses';

/** Sprite caricato: bitmap + rettangolo opaco per ogni frame (per una zona cliccabile aderente). */
export interface Sheet {
  img: ImageBitmap;
  count: number;
  fps: number;
  height: number;
  fw: number;
  fh: number;
  /** bounding box opaca per frame, in frazioni 0-1 del frame [x0,y0,x1,y1] */
  boxes: [number, number, number, number][];
}

export interface LoadedPack {
  strips: Record<string, Sheet>;
  poses: Record<string, Sheet>;
}

const cache: LoadedPack = { strips: {}, poses: {} };
let loading: Promise<LoadedPack> | null = null;

async function dataDir(): Promise<string> {
  return invoke<string>('data_dir');
}

export async function packDir(kind: PackKind): Promise<string> {
  return `${await dataDir()}\\profiles\\petpack\\${kind}`;
}

export function packReady(kind: PackKind): boolean {
  const f = useApp.getState().settings.pet.files[kind] ?? {};
  return kind === 'strips' ? ['idle', 'dangle', 'perch'].every((k) => f[k]) : !!f.base;
}

/** Scarica un pacchetto dagli originali (consenso esplicito dall'utente nelle impostazioni). */
export async function downloadPack(kind: PackKind, onProgress?: (done: number, total: number) => void): Promise<void> {
  const dir = await packDir(kind);
  await invoke('ensure_dir', { path: dir });
  const entries: [string, string][] =
    kind === 'strips' ? Object.keys(STRIPS).map((k) => [k, `${STRIPS_REPO}${k}.png`]) : Object.entries(POSES).map(([k, p]) => [k, `${POSES_REPO}${p}`]);
  const files: Record<string, string> = {};
  let done = 0;
  for (const [name, url] of entries) {
    const dest = `${dir}\\${name}.png`;
    try {
      if (!(await invoke<boolean>('path_exists', { path: dest }))) await invoke('download_file', { url, dest });
      files[name] = dest;
    } catch (e) {
      log('warn', 'pet', `${name}: ${String(e)}`);
    }
    onProgress?.(++done, entries.length);
  }
  useApp.getState().setSettings((s) => ({ ...s, pet: { ...s.pet, files: { ...s.pet.files, [kind]: files } } }));
  resetPackCache();
}

/** Importa un pacchetto da una cartella locale (file con gli stessi nomi degli originali). */
export async function importPackFolder(kind: PackKind, folder: string): Promise<number> {
  const names = await invoke<string[]>('list_dir', { path: folder });
  const want = kind === 'strips' ? Object.keys(STRIPS) : Object.keys(POSES);
  const files: Record<string, string> = { ...(useApp.getState().settings.pet.files[kind] ?? {}) };
  let n = 0;
  for (const name of want) {
    const base = (kind === 'poses' ? POSES[name].split('/').pop() : `${name}.png`) ?? `${name}.png`;
    const hit = names.find((f) => f.toLowerCase() === base.toLowerCase());
    if (!hit) continue;
    files[name] = await invoke<string>('import_file', { src: `${folder}\\${hit}`, subDir: `petpack/${kind}` });
    n++;
  }
  useApp.getState().setSettings((s) => ({ ...s, pet: { ...s.pet, files: { ...s.pet.files, [kind]: files } } }));
  resetPackCache();
  return n;
}

export function resetPackCache() {
  urls.clear();
  cache.strips = {};
  cache.poses = {};
  loading = null;
}

const STEP = 8;

async function loadSheet(path: string, def: ClipDef): Promise<Sheet> {
  const buf = await invoke<ArrayBuffer>('read_bytes', { path });
  const img = await createImageBitmap(new Blob([buf], { type: 'image/png' }));
  const fw = Math.floor(img.width / def.count);
  const fh = img.height;
  // analisi alfa a risoluzione ridotta: bounding box opaca di ogni frame
  const aw = Math.max(1, Math.ceil(fw / STEP));
  const ah = Math.max(1, Math.ceil(fh / STEP));
  const c = new OffscreenCanvas(aw * def.count, ah);
  const ctx = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  const boxes: Sheet['boxes'] = [];
  if (ctx) {
    ctx.drawImage(img, 0, 0, aw * def.count, ah);
    const data = ctx.getImageData(0, 0, aw * def.count, ah).data;
    for (let f = 0; f < def.count; f++) {
      let x0 = aw,
        y0 = ah,
        x1 = -1,
        y1 = -1;
      for (let y = 0; y < ah; y++)
        for (let x = 0; x < aw; x++) {
          const a = data[(y * aw * def.count + f * aw + x) * 4 + 3];
          if (a > 24) {
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
          }
        }
      boxes.push(x1 < 0 ? [0.3, 0.1, 0.7, 1] : [x0 / aw, y0 / ah, (x1 + 1) / aw, (y1 + 1) / ah]);
    }
  }
  return { img, count: def.count, fps: def.fps, height: def.height, fw, fh, boxes };
}

/** Carica in memoria i pacchetti presenti (una volta sola). */
export function loadPacks(): Promise<LoadedPack> {
  if (loading) return loading;
  const files = useApp.getState().settings.pet.files;
  loading = (async () => {
    for (const [name, def] of Object.entries(STRIPS)) {
      const p = files.strips?.[name];
      if (!p) continue;
      try {
        cache.strips[name] = await loadSheet(p, def);
      } catch (e) {
        log('warn', 'pet', `sprite ${name}: ${String(e)}`);
      }
    }
    for (const name of Object.keys(POSES)) {
      const p = files.poses?.[name];
      if (!p) continue;
      try {
        cache.poses[name] = await loadSheet(p, { count: 1, fps: 1, height: 1 });
      } catch (e) {
        log('warn', 'pet', `posa ${name}: ${String(e)}`);
      }
    }
    return cache;
  })();
  return loading;
}

/** URL immagine di una posa (per <img> nel fumetto / cut-in). */
const urls = new Map<string, string>();
export function poseUrl(name: string): string | null {
  const s = cache.poses[name];
  if (!s) return null;
  const hit = urls.get(name);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = s.fw;
  c.height = s.fh;
  c.getContext('2d')?.drawImage(s.img, 0, 0);
  const u = c.toDataURL('image/png');
  urls.set(name, u);
  return u;
}
