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
  ui: { showHud: boolean; balloonSec: number; userName: string; mode: 'classic' | 'capri'; lang: '' | 'it' | 'en' };
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
  firstRun: boolean;
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
