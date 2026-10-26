export type ProviderId = 'local' | 'gemini' | 'extra' | 'openrouter';
export type Task = 'chat' | 'vision' | 'stt';

export interface GeminiKey {
  id: string;
  label: string;
  key: string;
  enabled: boolean;
}

/** Stati sprite noti. Se ne possono aggiungere di personalizzati. */
export const SPRITE_STATES = [
  'idle',
  'blink',
  'talk',
  'listen',
  'think',
  'happy',
  'angry',
  'sad',
  'surprised',
  'love',
  'smug',
  'sleep',
  'dormant',
] as const;

export interface Outfit {
  id: string;
  name: string;
  /** stato -> lista di frame (percorsi file assoluti) */
  states: Record<string, string[]>;
}

export interface AvatarLayout {
  x: number;
  y: number;
  /** larghezza in px dello slot */
  width: number;
  flip: boolean;
  fps: number;
  breathing: boolean;
}

export interface VoiceConfig {
  engine: 'default' | 'piper' | 'webspeech' | 'elevenlabs' | 'off';
  piperModel: string;
  piperSpeaker: number | null;
  lengthScale: number;
  webVoice: string;
  webRate: number;
  webPitch: number;
  elevenVoiceId: string;
}

export interface Profile {
  id: string;
  name: string;
  personalityId: string;
  customPrompt: string;
  voice: VoiceConfig;
  layout: AvatarLayout;
  outfits: Outfit[];
  activeOutfitId: string;
  /** mood salvato (stato sprite di riposo) */
  mood: string;
}

export interface Settings {
  order: ProviderId[];
  local: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    chatModel: string;
    visionModel: string;
    timeoutSec: number;
    vramCapGb: number;
  };
  gemini: {
    enabled: boolean;
    keys: GeminiKey[];
    models: string[];
    cooldownSec: number;
  };
  openrouter: {
    enabled: boolean;
    key: string;
    preferred: string[];
  };
  stt: {
    mode: 'whisper' | 'cloud' | 'off';
    whisperExe: string;
    whisperModel: string;
    port: number;
    threads: number;
    language: string;
    autoStart: boolean;
    continuous: boolean;
    vadThreshold: number;
  };
  tts: {
    engine: 'piper' | 'webspeech' | 'elevenlabs' | 'off';
    piperExe: string;
    piperModel: string;
    elevenKey: string;
    volume: number;
  };
  vision: {
    enabled: boolean;
    intervalSec: number;
    maxWidth: number;
    react: boolean;
    minReactGapSec: number;
  };
  hotkey: string;
  activeProfileId: string;
  ui: { showHud: boolean; balloonSec: number; userName: string; mode: 'classic' | 'capri'; lang: '' | 'it' | 'en' | 'pl' };
  capri: { frameWidth: number; sleepSec: number; typeCps: number; glitch: boolean };
  music: {
    provider: 'auto' | 'swiftfree' | 'spotify';
    swiftfree: { baseUrl: string; token: string; exePath: string; autoLaunch: boolean };
  };
  spotify: {
    enabled: boolean;
    clientId: string;
    port: number;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };
  /** altri provider gratuiti OpenAI-compatibili */
  extra: ExtraProvider[];
  tools: { on: boolean; apps: boolean; web: boolean; screen: boolean; calls: boolean };
  passive: { on: boolean; words: string; greeting: string };
  contacts: Contact[];
  clip: ClipSettings;
  lovense: LovenseSettings;
  firstRun: boolean;
}

export type ClipBackend = 'auto' | 'medal' | 'amd' | 'nvidia' | 'gamebar' | 'custom';

export interface ClipSettings {
  enabled: boolean;
  /** ascolta il microfono anche senza Hey Capri, solo per le frasi del clip */
  voice: boolean;
  backend: ClipBackend;
  /** frasi che fanno partire il clip (separate da virgola) */
  phrases: string;
  hotkeys: { medal: string; amd: string; nvidia: string; gamebar: string; custom: string };
  /** frase detta dopo il clip (vuota = solo fumetto) */
  reply: string;
  sound: boolean;
}

export interface LovensePattern {
  id: string;
  name: string;
  /** funzioni: v vibrate, r rotate, p pump, t thrust, f fingering, s suction, d depth, o oscillate ('' = tutte) */
  features: string;
  /** intervallo tra i passi (ms, minimo 100) */
  intervalMs: number;
  /** livelli 0-20 */
  steps: number[];
  /** durata predefinita (s, 0 = finché non si ferma) */
  durationSec: number;
}

export interface LovenseSettings {
  enabled: boolean;
  /** URL della Lovense Remote (Game Mode), es. https://192-168-1-44.lovense.club:30010 */
  url: string;
  /** id del giocattolo ('' = tutti) */
  toy: string;
  /** limite massimo d'intensità 0-20: tutti i comandi vengono scalati */
  maxLevel: number;
  /** l'AI può usare i tag <toy> */
  aiControl: boolean;
  /** mood della risposta → pattern */
  moodLink: boolean;
  moodMap: Record<string, string>;
  moodSec: number;
  patterns: LovensePattern[];
}

export interface ExtraProvider {
  id: string;
  name: string;
  enabled: boolean;
  base: string;
  key: string;
  models: string;
  vision: string;
  signup: string;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
}

export type Part =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' } };

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant';
  content: string | Part[];
}

export interface Fact {
  id: string;
  text: string;
  ts: number;
}

export interface LogEntry {
  id: number;
  ts: number;
  level: 'info' | 'warn' | 'error' | 'ok';
  src: string;
  msg: string;
}
