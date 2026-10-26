import { create } from 'zustand';
import { load, type Store } from '@tauri-apps/plugin-store';
import type { Fact, LogEntry, Profile, Settings } from './types';
import I18N from './i18n';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const DEFAULT_SETTINGS: Settings = {
  order: ['local', 'gemini', 'extra', 'openrouter'],
  local: {
    enabled: true,
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: '',
    chatModel: 'qwen2.5:7b',
    visionModel: 'gemma3:4b',
    timeoutSec: 90,
    vramCapGb: 6.5,
  },
  gemini: {
    enabled: true,
    keys: [],
    models: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash'],
    cooldownSec: 60,
  },
  openrouter: { enabled: true, key: '', preferred: [] },
  stt: {
    mode: 'whisper',
    whisperExe: '',
    whisperModel: '',
    port: 8178,
    threads: 4,
    language: 'it',
    autoStart: true,
    continuous: false,
    vadThreshold: 0.02,
  },
  tts: { engine: 'piper', piperExe: '', piperModel: '', elevenKey: '', volume: 0.9 },
  vision: { enabled: false, intervalSec: 45, maxWidth: 1024, react: true, minReactGapSec: 120 },
  hotkey: 'CommandOrControl+Shift+W',
  activeProfileId: '',
  ui: { showHud: true, balloonSec: 9, userName: '', mode: 'capri', lang: '' },
  capri: { frameWidth: 380, sleepSec: 90, typeCps: 32, glitch: true },
  music: {
    provider: 'auto',
    swiftfree: { baseUrl: 'http://127.0.0.1:47800', token: '', exePath: '', autoLaunch: true },
  },
  spotify: { enabled: true, clientId: '', port: 8888, accessToken: '', refreshToken: '', expiresAt: 0 },
  extra: [
    { id: 'groq', name: 'Groq', enabled: true, base: 'https://api.groq.com/openai/v1', key: '', models: 'llama-3.3-70b-versatile, openai/gpt-oss-120b, llama-3.1-8b-instant', vision: 'meta-llama/llama-4-scout-17b-16e-instruct', signup: 'console.groq.com' },
    { id: 'cerebras', name: 'Cerebras', enabled: true, base: 'https://api.cerebras.ai/v1', key: '', models: 'gpt-oss-120b, llama-3.3-70b, qwen-3-32b', vision: '', signup: 'cloud.cerebras.ai' },
    { id: 'mistral', name: 'Mistral', enabled: true, base: 'https://api.mistral.ai/v1', key: '', models: 'mistral-small-latest, open-mistral-nemo', vision: 'mistral-small-latest', signup: 'console.mistral.ai (piano Experiment)' },
    { id: 'github', name: 'GitHub Models', enabled: true, base: 'https://models.github.ai/inference', key: '', models: 'openai/gpt-4.1-mini, meta/Llama-3.3-70B-Instruct', vision: 'openai/gpt-4.1-mini', signup: 'github.com/settings/tokens (permesso models)' },
    { id: 'nvidia', name: 'NVIDIA NIM', enabled: true, base: 'https://integrate.api.nvidia.com/v1', key: '', models: 'meta/llama-3.3-70b-instruct, qwen/qwen2.5-7b-instruct', vision: 'meta/llama-3.2-11b-vision-instruct', signup: 'build.nvidia.com' },
    { id: 'hf', name: 'Hugging Face', enabled: true, base: 'https://router.huggingface.co/v1', key: '', models: 'meta-llama/Llama-3.3-70B-Instruct, Qwen/Qwen2.5-72B-Instruct', vision: '', signup: 'huggingface.co/settings/tokens' },
    { id: 'cloudflare', name: 'Cloudflare Workers AI', enabled: true, base: 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1', key: '', models: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', vision: '', signup: 'dash.cloudflare.com (sostituisci ACCOUNT_ID)' },
  ],
  tools: { on: true, apps: true, web: true, screen: true, calls: true },
  passive: { on: false, words: 'hey capri, ehi capri', greeting: '' },
  contacts: [],
  firstRun: true,
};

export function newProfile(name = 'Nyx'): Profile {
  const outfitId = uid();
  return {
    id: uid(),
    name,
    personalityId: 'tsundere',
    customPrompt: '',
    voice: {
      engine: 'default',
      piperModel: '',
      piperSpeaker: null,
      lengthScale: 1,
      webVoice: '',
      webRate: 1.05,
      webPitch: 1.25,
      elevenVoiceId: '',
    },
    layout: { x: -1, y: -1, width: 320, flip: false, fps: 8, breathing: true },
    outfits: [{ id: outfitId, name: 'Base', states: {} }],
    activeOutfitId: outfitId,
    mood: 'idle',
  };
}

export interface UiChatLine {
  role: 'user' | 'assistant' | 'system';
  text: string;
  ts: number;
  meta?: string;
}

interface Status {
  provider: string;
  model: string;
  thinking: boolean;
  listening: boolean;
  speaking: boolean;
  vramGb: number | null;
  sttReady: boolean;
  lastScreen: string;
}

interface AppState {
  ready: boolean;
  settings: Settings;
  profiles: Profile[];
  facts: Fact[];
  logs: LogEntry[];
  chat: UiChatLine[];
  status: Status;
  balloon: { text: string; mood: string; ts: number } | null;
  /** ultimo scambio per il terminale Capri */
  exchange: { user: string; np: string; ts: number };
  /** conferma chiamata in corso */
  confirm: { label: string; until: number; run: () => void } | null;
  setConfirm: (c: AppState['confirm']) => void;
  /** stato sprite temporaneo (es. mood dalla risposta) */
  transientMood: string | null;
  panel: 'none' | 'chat' | 'settings';
  settingsTab: string;
  lockInteractive: boolean;

  setSettings: (fn: (s: Settings) => Settings) => void;
  updateProfile: (id: string, fn: (p: Profile) => Profile) => void;
  addProfile: (p: Profile) => void;
  removeProfile: (id: string) => void;
  addFact: (text: string) => void;
  removeFact: (id: string) => void;
  clearFacts: () => void;
  log: (level: LogEntry['level'], src: string, msg: string) => void;
  setStatus: (p: Partial<Status>) => void;
  showBalloon: (text: string, mood: string) => void;
  setExchange: (p: Partial<AppState['exchange']>) => void;
  pushChat: (l: UiChatLine) => void;
  setPanel: (p: AppState['panel'], tab?: string) => void;
  setTransientMood: (m: string | null) => void;
  setLock: (v: boolean) => void;
}

let logSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  settings: DEFAULT_SETTINGS,
  profiles: [],
  facts: [],
  logs: [],
  chat: [],
  status: {
    provider: '-',
    model: '-',
    thinking: false,
    listening: false,
    speaking: false,
    vramGb: null,
    sttReady: false,
    lastScreen: '',
  },
  balloon: null,
  exchange: { user: '', np: '', ts: 0 },
  confirm: null,
  setConfirm: (c) => set({ confirm: c }),
  transientMood: null,
  panel: 'none',
  settingsTab: 'avatar',
  lockInteractive: false,

  setSettings: (fn) => set({ settings: fn(get().settings) }),
  updateProfile: (id, fn) => set({ profiles: get().profiles.map((p) => (p.id === id ? fn(p) : p)) }),
  addProfile: (p) => set({ profiles: [...get().profiles, p] }),
  removeProfile: (id) => {
    const profiles = get().profiles.filter((p) => p.id !== id);
    const settings = get().settings;
    set({
      profiles,
      settings:
        settings.activeProfileId === id ? { ...settings, activeProfileId: profiles[0]?.id ?? '' } : settings,
    });
  },
  addFact: (text) => {
    const t = text.trim();
    if (!t) return;
    const facts = get().facts;
    if (facts.some((f) => f.text.toLowerCase() === t.toLowerCase())) return;
    set({ facts: [...facts, { id: uid(), text: t, ts: Date.now() }].slice(-300) });
  },
  removeFact: (id) => set({ facts: get().facts.filter((f) => f.id !== id) }),
  clearFacts: () => set({ facts: [] }),
  log: (level, src, msg) => {
    const e: LogEntry = { id: ++logSeq, ts: Date.now(), level, src, msg };
    set({ logs: [...get().logs, e].slice(-400) });
    // eslint-disable-next-line no-console
    console.log(`[${src}] ${msg}`);
  },
  setStatus: (p) => set({ status: { ...get().status, ...p } }),
  showBalloon: (text, mood) => set({ balloon: { text, mood, ts: Date.now() } }),
  setExchange: (p) => set({ exchange: { ...get().exchange, ...p, ts: Date.now() } }),
  pushChat: (l) => set({ chat: [...get().chat, l].slice(-200) }),
  setPanel: (panel, tab) => set({ panel, settingsTab: tab ?? get().settingsTab }),
  setTransientMood: (m) => set({ transientMood: m }),
  setLock: (v) => set({ lockInteractive: v }),
}));

export function activeProfile(): Profile | undefined {
  const { profiles, settings } = useApp.getState();
  return profiles.find((p) => p.id === settings.activeProfileId) ?? profiles[0];
}

export const log = (level: LogEntry['level'], src: string, msg: string) => useApp.getState().log(level, src, msg);

// ------------------------------------------------------------ persistenza

let disk: Store | null = null;

function mergeSettings(saved: Partial<Settings> | null | undefined): Settings {
  const d = DEFAULT_SETTINGS;
  if (!saved) return d;
  return {
    ...d,
    ...saved,
    local: { ...d.local, ...(saved.local ?? {}) },
    gemini: { ...d.gemini, ...(saved.gemini ?? {}) },
    openrouter: { ...d.openrouter, ...(saved.openrouter ?? {}) },
    stt: { ...d.stt, ...(saved.stt ?? {}) },
    tts: { ...d.tts, ...(saved.tts ?? {}) },
    vision: { ...d.vision, ...(saved.vision ?? {}) },
    ui: { ...d.ui, ...(saved.ui ?? {}) },
    capri: { ...d.capri, ...(saved.capri ?? {}) },
    spotify: { ...d.spotify, ...(saved.spotify ?? {}) },
    tools: { ...d.tools, ...(saved.tools ?? {}) },
    passive: { ...d.passive, ...(saved.passive ?? {}) },
    contacts: saved.contacts ?? [],
    extra: [
      ...d.extra.map((x) => ({ ...x, ...((saved.extra ?? []).find((y) => y.id === x.id) ?? {}) })),
      ...(saved.extra ?? []).filter((y) => !d.extra.some((x) => x.id === y.id)),
    ],
    order: (() => {
      const o = [...(saved.order ?? d.order)];
      if (!o.includes('extra')) o.splice(Math.max(0, o.indexOf('openrouter')), 0, 'extra');
      return o;
    })(),
    music: {
      ...d.music,
      ...(saved.music ?? {}),
      swiftfree: { ...d.music.swiftfree, ...(saved.music?.swiftfree ?? {}) },
    },
  };
}

export async function loadPersisted(): Promise<void> {
  try {
    disk = await load('cyberai.json', { autoSave: false, defaults: {} });
    const settings = mergeSettings(await disk.get<Settings>('settings'));
    if (!settings.ui.lang) {
      settings.ui = { ...settings.ui, lang: I18N.detect() };
      if (settings.ui.lang === 'en' && settings.stt.language === 'it') settings.stt = { ...settings.stt, language: 'en' };
    }
    let profiles = (await disk.get<Profile[]>('profiles')) ?? [];
    const facts = (await disk.get<Fact[]>('facts')) ?? [];
    if (!profiles.length) profiles = [newProfile()];
    if (!profiles.some((p) => p.id === settings.activeProfileId)) settings.activeProfileId = profiles[0].id;
    useApp.setState({ settings, profiles, facts, ready: true });
  } catch (e) {
    const p = newProfile();
    useApp.setState({ profiles: [p], settings: { ...DEFAULT_SETTINGS, activeProfileId: p.id }, ready: true });
    log('error', 'store', `caricamento impostazioni fallito: ${String(e)}`);
  }

  let timer: number | undefined;
  useApp.subscribe((s, prev) => {
    if (s.settings === prev.settings && s.profiles === prev.profiles && s.facts === prev.facts) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      if (!disk) return;
      const st = useApp.getState();
      try {
        await disk.set('settings', st.settings);
        await disk.set('profiles', st.profiles);
        await disk.set('facts', st.facts);
        await disk.save();
      } catch (e) {
        log('error', 'store', `salvataggio fallito: ${String(e)}`);
      }
    }, 600);
  });
}
