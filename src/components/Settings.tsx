import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { ask, resetConversation, visionTick } from '../lib/brain';
import { useHitRef } from '../lib/hit';
import { PERSONALITIES } from '../lib/personalities';
import {
  providerCd,
  testChat,
  geminiKeyStatus,
  listGeminiModels,
  listModels,
  openRouterFreeModels,
  resetGeminiKeys,
} from '../lib/router';
import { log, newProfile, uid, useApp } from '../lib/store';
import { ensureWhisper } from '../lib/stt';
import { swiftPlay, swiftStatus } from '../lib/swiftfree';
import { connectSpotify, disconnectSpotify, play as spotifyPlay, spotifyConnected } from '../lib/spotify';
import { downloadPiperVoice, speak, webVoices } from '../lib/tts';
import { ClipTab, LovenseTab } from './Extras';
import { isVideo } from '../lib/useSprite';
import { SPRITE_STATES, type Profile, type ProviderId, type Settings as S } from '../lib/types';
import { Btn, Chip, Field, H, Select, Toggle } from './ui';
import I18N, { T } from '../lib/i18n';

/** Cambia lingua: salva, adegua STT/voce e ricarica (il DOM tradotto non torna indietro da solo). */
function switchLang(l: 'it' | 'en' | 'pl') {
  const st = useApp.getState();
  if (st.settings.ui.lang === l) return;
  const stt = /^(it|en|pl)$/.test(st.settings.stt.language) ? { ...st.settings.stt, language: l } : st.settings.stt;
  useApp.setState({ settings: { ...st.settings, ui: { ...st.settings.ui, lang: l }, stt } });
  I18N.set(l);
  window.setTimeout(() => location.reload(), 1200);
}

const TABS = [
  ['capri', 'Modalità'],
  ['avatar', 'Avatar'],
  ['persona', 'Personalità'],
  ['voce', 'Voce'],
  ['ascolto', 'Ascolto'],
  ['visione', 'Visione'],
  ['locale', 'AI locale'],
  ['cloud', 'API cloud'],
  ['free', 'API free'],
  ['strumenti', 'Strumenti'],
  ['passivo', 'Hey Capri'],
  ['clip', 'Clip'],
  ['lovense', 'Lovense'],
  ['memoria', 'Memoria'],
  ['log', 'Log'],
] as const;

const IMG_EXT = ['png', 'webp', 'gif', 'jpg', 'jpeg', 'apng', 'webm', 'mp4'];

async function pickFile(name: string, extensions: string[], multiple = false): Promise<string[]> {
  const r = await open({ multiple, directory: false, filters: [{ name, extensions }] });
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

function useActive(): [Profile, (fn: (p: Profile) => Profile) => void] {
  const prof = useApp((s) => s.profiles.find((p) => p.id === s.settings.activeProfileId) ?? s.profiles[0]);
  const update = useApp((s) => s.updateProfile);
  return [prof, (fn) => update(prof.id, fn)];
}

function useSet() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const patch = <K extends keyof S>(k: K, v: Partial<S[K]> | S[K]) =>
    setSettings((s) => ({
      ...s,
      [k]: typeof v === 'object' && !Array.isArray(v) && v !== null ? { ...(s[k] as object), ...(v as object) } : v,
    }));
  return { s: settings, patch };
}

function PathField({ label, value, onChange, ext, hint }: { label: string; value: string; onChange: (v: string) => void; ext: string[]; hint?: string }) {
  return (
    <div className="flex items-end gap-2">
      <Field className="flex-1" label={label} value={value} onChange={onChange} hint={hint} />
      <Btn variant="ghost" className={hint ? 'mb-6' : ''} onClick={async () => {
          const f = (await pickFile(label, ext))[0];
          if (f) onChange(f);
        }}>
        Sfoglia
      </Btn>
    </div>
  );
}


// ================================================================ MODALITÀ / CAPRI / SPOTIFY

function ModeTab() {
  const { s, patch } = useSet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [sq, setSq] = useState('');
  const [sf, setSf] = useState('');
  const connected = spotifyConnected();
  const redirect = `http://127.0.0.1:${s.spotify.port}/callback`;
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3" data-noi18n>
        <H n="L">Lingua · Language · Język</H>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['it', 'Italiano'],
              ['en', 'English'],
              ['pl', 'Polski'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={s.ui.lang === id}
              onClick={() => switchLang(id)}
              className={`cursor-pointer border p-3 text-left font-display text-[14px] font-bold tracking-[2px] uppercase italic ${s.ui.lang === id ? 'border-yellow bg-yellow/10 text-yellow' : 'border-edge bg-panel text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="text-[13px] text-dim">{
            {
              it: "Interfaccia, risposte, riconoscimento vocale e voce passano all'italiano. L'app si ricarica.",
              en: 'Interface, replies, speech recognition and voice switch to English. The app reloads.',
              pl: 'Interfejs, odpowiedzi, rozpoznawanie mowy i głos przełączają się na polski. Aplikacja się przeładuje.',
            }[s.ui.lang || 'it']
          }</div>
      </section>

      <section className="flex flex-col gap-3">
        <H n="00">Interfaccia</H>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['capri', 'Capri', 'Sigillo dormiente + finestra glitch + terminale'],
              ['classic', 'Classica', 'Avatar libero sul desktop + fumetto'],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              aria-pressed={s.ui.mode === id}
              onClick={() => patch('ui', { mode: id })}
              className={`cursor-pointer border p-3 text-left ${s.ui.mode === id ? 'border-yellow bg-yellow/10' : 'border-edge bg-panel'}`}
            >
              <div className={`font-display text-[14px] font-bold tracking-[2px] uppercase italic ${s.ui.mode === id ? 'text-yellow' : 'text-muted'}`}>{label}</div>
              <div className="text-[13px] text-dim">{hint}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <H n="01">Capri</H>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Larghezza finestra (px)" type="number" value={s.capri.frameWidth} onChange={(v) => patch('capri', { frameWidth: Math.max(220, Number(v) || 380) })} />
          <Field label="Dormiente dopo (s)" type="number" value={s.capri.sleepSec} onChange={(v) => patch('capri', { sleepSec: Math.max(10, Number(v) || 90) })} />
          <Field label="Velocità testo (car/s)" type="number" value={s.capri.typeCps} onChange={(v) => patch('capri', { typeCps: Math.max(5, Number(v) || 32) })} />
        </div>
        <Toggle label="Effetti glitch" hint="Transizioni e disturbi RGB" on={s.capri.glitch} onChange={(v) => patch('capri', { glitch: v })} />
        <Select
          label="Drag mode"
          value={s.capri.dragMode}
          onChange={(v) => patch('capri', { dragMode: v as S['capri']['dragMode'] })}
          options={[
            { value: 'lightning', label: 'Lightning: lazo a fulmine, poi salta lì' },
            { value: 'normal', label: 'Normal: trascina dall’etichetta' },
          ]}
        />
        <p className="m-0 text-[14px] text-muted">Tasto destro su Capri = menu (microfono, voce, memoria, instant replay, clingy mode, drag mode).</p>
        <Toggle
          label="Visibile in Discord / OBS"
          hint="Capri compare nella condivisione schermo e nelle registrazioni. Dai suoi screenshot resta comunque esclusa."
          on={s.ui.streamVisible}
          onChange={(v) => patch('ui', { streamVisible: v })}
        />
        <p className="m-0 text-[14px] text-muted">
          Sprite consigliati: <b>dormant</b> (sigillo piccolo, senza sfondo), <b>idle</b>, <b>listen</b>, <b>think</b>, <b>talk</b> e i mood. In questa modalità puoi
          importare anche clip video <b>webm/mp4</b> in loop. Click sul sigillo = parla, tasto destro = impostazioni, rotella sulla finestra = dimensione,
          trascina l'etichetta per spostare.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <H n="02">Musica · swiftFree</H>
        <Select
          label="Lettore usato dall'AI"
          value={s.music.provider}
          onChange={(v) => patch('music', { provider: v as S['music']['provider'] })}
          options={[
            { value: 'auto', label: 'Automatico (swiftFree se attivo, poi Spotify)' },
            { value: 'swiftfree', label: 'swiftFree' },
            { value: 'spotify', label: 'Spotify' },
          ]}
        />
        <Field
          label="Indirizzo controllo swiftFree"
          value={s.music.swiftfree.baseUrl}
          onChange={(v) => patch('music', { swiftfree: { ...s.music.swiftfree, baseUrl: v.trim() } })}
          hint="Server di controllo locale di swiftFree (vedi docs/SWIFTFREE_API.md)"
        />
        <Field
          label="Token (opzionale)"
          type="password"
          value={s.music.swiftfree.token}
          onChange={(v) => patch('music', { swiftfree: { ...s.music.swiftfree, token: v } })}
        />
        <PathField
          label="swiftify.exe (per avviarlo se è chiuso)"
          value={s.music.swiftfree.exePath}
          onChange={(v) => patch('music', { swiftfree: { ...s.music.swiftfree, exePath: v } })}
          ext={['exe']}
        />
        <Toggle
          label="Avvia swiftFree automaticamente"
          on={s.music.swiftfree.autoLaunch}
          onChange={(v) => patch('music', { swiftfree: { ...s.music.swiftfree, autoLaunch: v } })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Btn
            variant="cyan"
            onClick={async () => {
              const st = await swiftStatus();
              setSf(st ? `ONLINE · ${st.app} ${st.version}${st.track ? ' · ' + st.track.title : ''}` : 'NON RAGGIUNGIBILE');
            }}
          >
            Verifica connessione
          </Btn>
          {sf && <Chip tone={sf.startsWith('ONLINE') ? 'ok' : 'error'}>{sf}</Chip>}
        </div>
        <div className="flex items-end gap-2">
          <Field className="flex-1" label="Prova swiftFree" value={sq} onChange={setSq} placeholder="Looping the Rooms rusino" />
          <Btn variant="cyan" disabled={!sq} onClick={() => void swiftPlay(sq).catch((e) => log('error', 'swiftfree', String(e)))}>
            ▶ Play
          </Btn>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <H n="03">Spotify</H>
        <Toggle label="Controllo musica" hint='"metti In Love With Myself", "pausa", "prossima"' on={s.spotify.enabled} onChange={(v) => patch('spotify', { enabled: v })} />
        <ol className="m-0 flex flex-col gap-1 pl-5 text-[14px] text-muted">
          <li>Vai su developer.spotify.com → Dashboard → Create app.</li>
          <li>
            Redirect URI: <span className="font-mono text-cyan select-text">{redirect}</span> · API: Web API.
          </li>
          <li>Copia il Client ID qui sotto e premi Collega.</li>
        </ol>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="Client ID" value={s.spotify.clientId} onChange={(v) => patch('spotify', { clientId: v.trim() })} />
          <Field label="Porta callback" type="number" value={s.spotify.port} onChange={(v) => patch('spotify', { port: Number(v) || 8888 })} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn
            variant="primary"
            disabled={busy || !s.spotify.clientId}
            onClick={async () => {
              setBusy(true);
              setErr('');
              try {
                await connectSpotify();
              } catch (e) {
                setErr(String(e instanceof Error ? e.message : e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'In attesa del browser…' : connected ? 'Ricollega' : 'Collega Spotify'}
          </Btn>
          {connected && (
            <Btn variant="danger" onClick={disconnectSpotify}>
              Scollega
            </Btn>
          )}
          <Chip tone={connected ? 'ok' : 'idle'}>{connected ? 'COLLEGATO' : 'NON COLLEGATO'}</Chip>
        </div>
        {err && <div className="border border-red bg-red/10 p-2 font-mono text-[12px] text-red">{err}</div>}
        <p className="m-0 text-[13px] text-dim">
          Avvio automatico del brano: serve Spotify Premium. Senza Premium (o senza collegamento) apro il brano o la ricerca nell'app e uso i tasti
          multimediali per play/pausa/avanti.
        </p>
        <div className="flex items-end gap-2">
          <Field className="flex-1" label="Prova" value={q} onChange={setQ} placeholder="Looping the Rooms rusino" />
          <Btn variant="cyan" disabled={!q} onClick={() => void spotifyPlay(q).catch((e) => log('error', 'spotify', String(e)))}>
            ▶ Play
          </Btn>
        </div>
      </section>
    </div>
  );
}

// ================================================================ AVATAR

function AvatarTab() {
  const profiles = useApp((s) => s.profiles);
  const activeId = useApp((s) => s.settings.activeProfileId);
  const { patch } = useSet();
  const addProfile = useApp((s) => s.addProfile);
  const removeProfile = useApp((s) => s.removeProfile);
  const [prof, update] = useActive();
  const [customState, setCustomState] = useState('');
  const outfit = prof.outfits.find((o) => o.id === prof.activeOutfitId) ?? prof.outfits[0];

  const updOutfit = (fn: (states: Record<string, string[]>) => Record<string, string[]>) =>
    update((p) => ({ ...p, outfits: p.outfits.map((o) => (o.id === outfit.id ? { ...o, states: fn(o.states) } : o)) }));

  const importFrames = async (state: string) => {
    const files = await pickFile('Sprite', IMG_EXT, true);
    const out: string[] = [];
    for (const f of files.sort()) {
      try {
        out.push(await invoke<string>('import_file', { src: f, subDir: `${prof.id}/${outfit.id}/${state}` }));
      } catch (e) {
        log('error', 'sprite', String(e));
      }
    }
    if (out.length) updOutfit((st) => ({ ...st, [state]: [...(st[state] ?? []), ...out] }));
  };

  const removeFrame = (state: string, path: string) => {
    updOutfit((st) => ({ ...st, [state]: (st[state] ?? []).filter((p) => p !== path) }));
    invoke('delete_file', { path }).catch(() => undefined);
  };

  const allStates = [...new Set([...SPRITE_STATES, ...Object.keys(outfit.states)])];

  return (
    <div className="flex flex-col gap-6">
      <section>
        <H n="01">Profili</H>
        <div className="flex flex-wrap gap-2">
          {profiles.map((p) => (
            <Btn key={p.id} variant={p.id === activeId ? 'primary' : 'ghost'} onClick={() => patch('activeProfileId', p.id)}>
              {p.name}
            </Btn>
          ))}
          <Btn
            variant="cyan"
            onClick={() => {
              const p = newProfile(`Profilo ${profiles.length + 1}`);
              addProfile(p);
              patch('activeProfileId', p.id);
            }}
          >
            + Nuovo
          </Btn>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Nome personaggio" value={prof.name} onChange={(v) => update((p) => ({ ...p, name: v }))} />
          <Btn variant="danger" disabled={profiles.length < 2} onClick={() => removeProfile(prof.id)}>
            Elimina profilo
          </Btn>
        </div>
      </section>

      <section>
        <H n="02">Outfit</H>
        <div className="flex flex-wrap gap-2">
          {prof.outfits.map((o) => (
            <Btn key={o.id} variant={o.id === outfit.id ? 'primary' : 'ghost'} onClick={() => update((p) => ({ ...p, activeOutfitId: o.id }))}>
              {o.name}
            </Btn>
          ))}
          <Btn
            variant="cyan"
            onClick={() => {
              const id = uid();
              update((p) => ({ ...p, outfits: [...p.outfits, { id, name: `Outfit ${p.outfits.length + 1}`, states: {} }], activeOutfitId: id }));
            }}
          >
            + Outfit
          </Btn>
          <Btn
            variant="ghost"
            onClick={() => {
              const id = uid();
              update((p) => ({ ...p, outfits: [...p.outfits, { id, name: `${outfit.name} copia`, states: { ...outfit.states } }], activeOutfitId: id }));
            }}
          >
            Duplica
          </Btn>
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3">
          <Field
            label="Nome outfit"
            value={outfit.name}
            onChange={(v) => update((p) => ({ ...p, outfits: p.outfits.map((o) => (o.id === outfit.id ? { ...o, name: v } : o)) }))}
          />
          <Btn
            variant="danger"
            disabled={prof.outfits.length < 2}
            onClick={() =>
              update((p) => {
                const outfits = p.outfits.filter((o) => o.id !== outfit.id);
                return { ...p, outfits, activeOutfitId: outfits[0].id };
              })
            }
          >
            Elimina outfit
          </Btn>
        </div>
      </section>

      <section>
        <H n="03">Sprite per stato</H>
        <p className="mt-0 mb-3 text-[14px] text-muted">
          Più frame per stato = animazione in loop. <b>talk</b>: frame bocca da chiusa ad aperta (lip sync sul volume). <b>blink</b>: occhi chiusi, usato a
          caso. Gli stati mood (happy, angry…) si attivano dalle risposte dell'AI.
        </p>
        <div className="flex flex-col gap-2">
          {allStates.map((st) => {
            const frames = outfit.states[st] ?? [];
            return (
              <div key={st} className="flex items-center gap-3 border border-edge bg-panel/60 p-2">
                <div className="w-24 shrink-0 font-mono text-[12px] text-yellow uppercase">
                  {st}
                  <div className="text-dim">{frames.length} frame</div>
                </div>
                <div className="flex flex-1 gap-1 overflow-x-auto">
                  {frames.map((f) => (
                    <button
                      key={f}
                      type="button"
                      title="Rimuovi frame"
                      aria-label={`Rimuovi frame ${st}`}
                      onClick={() => removeFrame(st, f)}
                      className="stripes h-14 w-14 shrink-0 cursor-pointer border border-edge hover:border-red"
                    >
                      {isVideo(f) ? (
                        <video src={convertFileSrc(f)} muted className="h-full w-full object-contain" />
                      ) : (
                        <img src={convertFileSrc(f)} alt="" className="h-full w-full object-contain" />
                      )}
                    </button>
                  ))}
                </div>
                <Btn variant="outline" onClick={() => void importFrames(st)}>
                  + Importa
                </Btn>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-end gap-2">
          <Field
            className="flex-1"
            label="Nuovo stato personalizzato"
            placeholder="es. dance, gaming, coffee"
            value={customState}
            onChange={(v) => setCustomState(v.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
          />
          <Btn
            variant="cyan"
            disabled={!customState}
            onClick={() => {
              updOutfit((st) => ({ ...st, [customState]: st[customState] ?? [] }));
              setCustomState('');
            }}
          >
            Aggiungi
          </Btn>
        </div>
      </section>

      <section>
        <H n="04">Posizione, dimensione, mood</H>
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Larghezza px"
            type="number"
            value={prof.layout.width}
            onChange={(v) => update((p) => ({ ...p, layout: { ...p.layout, width: Math.max(120, Number(v) || 320) } }))}
          />
          <Field label="FPS animazione" type="number" value={prof.layout.fps} onChange={(v) => update((p) => ({ ...p, layout: { ...p.layout, fps: Math.max(1, Number(v) || 8) } }))} />
          <Select
            label="Mood di riposo (salvato)"
            value={prof.mood}
            onChange={(v) => update((p) => ({ ...p, mood: v }))}
            options={allStates.map((x) => ({ value: x, label: x }))}
          />
        </div>
        <Toggle label="Specchia orizzontalmente" on={prof.layout.flip} onChange={(v) => update((p) => ({ ...p, layout: { ...p.layout, flip: v } }))} />
        <Toggle label="Respiro (breathing)" on={prof.layout.breathing} onChange={(v) => update((p) => ({ ...p, layout: { ...p.layout, breathing: v } }))} />
        <Btn variant="ghost" className="mt-3" onClick={() => update((p) => ({ ...p, layout: { ...p.layout, x: -1, y: -1 } }))}>
          Riporta in basso a destra
        </Btn>
      </section>
    </div>
  );
}

// ================================================================ PERSONALITÀ

function PersonaTab() {
  const [prof, update] = useActive();
  const { s, patch } = useSet();
  return (
    <div className="flex flex-col gap-5">
      <section>
        <H n="05">Personalità</H>
        <div className="grid grid-cols-3 gap-2">
          {PERSONALITIES.map((p) => {
            const on = p.id === prof.personalityId;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => update((x) => ({ ...x, personalityId: p.id }))}
                className="h-12 cursor-pointer border font-display text-[13px] font-bold tracking-[2px] uppercase italic"
                style={{ borderColor: on ? p.color : '#2a2438', color: on ? p.color : '#a9a3bd', background: on ? `${p.color}22` : '#15121c' }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </section>
      <section className="flex flex-col gap-1">
        <label htmlFor="cp" className="font-mono text-[11px] tracking-[1px] text-muted uppercase">
          {prof.personalityId === 'custom' ? 'Prompt personalità (completo)' : 'Istruzioni aggiuntive (opzionale)'}
        </label>
        <textarea
          id="cp"
          value={prof.customPrompt}
          onChange={(e) => update((p) => ({ ...p, customPrompt: e.target.value }))}
          rows={7}
          placeholder="es. Parli come una netrunner di Night City, adori il ramen e odi i bug in produzione."
          className="border border-edge bg-panel p-3 text-[13px] text-fg"
        />
      </section>
      <Field label="Come ti chiami (per l'AI)" value={s.ui.userName} onChange={(v) => patch('ui', { userName: v })} />
      <Field
        label="Durata fumetto (s)"
        type="number"
        value={s.ui.balloonSec}
        onChange={(v) => patch('ui', { balloonSec: Math.max(3, Number(v) || 9) })}
      />
    </div>
  );
}

// ================================================================ VOCE

function VoiceTab() {
  const [prof, update] = useActive();
  const { s, patch } = useSet();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const load = () => setVoices(webVoices());
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load);
  }, []);
  const v = prof.voice;
  const setV = (p: Partial<Profile['voice']>) => update((x) => ({ ...x, voice: { ...x.voice, ...p } }));
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <H n="06">Motore globale</H>
        <Select
          label="Motore TTS predefinito"
          value={s.tts.engine}
          onChange={(x) => patch('tts', { engine: x as S['tts']['engine'] })}
          options={[
            { value: 'piper', label: 'Piper (locale, consigliato)' },
            { value: 'webspeech', label: 'Voci Windows (offline)' },
            { value: 'elevenlabs', label: 'ElevenLabs (cloud)' },
            { value: 'blips', label: 'Blip stile Undertale (niente voce)' },
            { value: 'off', label: 'Disattivato' },
          ]}
        />
        {(s.tts.engine === 'blips' || prof.voice.engine === 'blips') && <BlipsFields />}
        <PathField label="piper.exe" value={s.tts.piperExe} onChange={(x) => patch('tts', { piperExe: x })} ext={['exe']} />
        <PathField label="Voce Piper predefinita (.onnx)" value={s.tts.piperModel} onChange={(x) => patch('tts', { piperModel: x })} ext={['onnx']} />
        <PiperLangVoices />
        <Field label="Volume 0-1" type="number" value={s.tts.volume} onChange={(x) => patch('tts', { volume: Math.min(1, Math.max(0, Number(x))) })} />
        <Field label="ElevenLabs API key" type="password" value={s.tts.elevenKey} onChange={(x) => patch('tts', { elevenKey: x })} />
      </section>
      <section className="flex flex-col gap-3">
        <H n="07">Voce di {prof.name}</H>
        <Select
          label="Motore per questo profilo"
          value={v.engine}
          onChange={(x) => setV({ engine: x as Profile['voice']['engine'] })}
          options={[
            { value: 'default', label: 'Usa predefinito' },
            { value: 'piper', label: 'Piper' },
            { value: 'webspeech', label: 'Voci Windows' },
            { value: 'elevenlabs', label: 'ElevenLabs' },
            { value: 'blips', label: 'Blip stile Undertale' },
            { value: 'off', label: 'Muta' },
          ]}
        />
        <PathField label="Voce Piper del profilo (.onnx, vuoto = predefinita)" value={v.piperModel} onChange={(x) => setV({ piperModel: x })} ext={['onnx']} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Speaker id (voci multi-speaker)" value={v.piperSpeaker ?? ''} onChange={(x) => setV({ piperSpeaker: x === '' ? null : Number(x) })} />
          <Field label="Velocità Piper (length scale, <1 = veloce)" type="number" value={v.lengthScale} onChange={(x) => setV({ lengthScale: Number(x) || 1 })} />
        </div>
        <Select
          label="Voce Windows"
          value={v.webVoice}
          onChange={(x) => setV({ webVoice: x })}
          options={[{ value: '', label: 'Automatica (femminile, lingua STT)' }, ...voices.map((x) => ({ value: x.name, label: `${x.name} · ${x.lang}` }))]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Velocità voce Windows" type="number" value={v.webRate} onChange={(x) => setV({ webRate: Number(x) || 1 })} />
          <Field label="Tono voce Windows (pitch)" type="number" value={v.webPitch} onChange={(x) => setV({ webPitch: Number(x) || 1 })} />
        </div>
        <Field label="ElevenLabs voice id" value={v.elevenVoiceId} onChange={(x) => setV({ elevenVoiceId: x })} />
        <Btn variant="cyan" onClick={() => void speak(`[mood:happy] ${T('Ciao, sono')} ${prof.name}. ${T('Sistemi neurali online, choom.')}`, prof)}>
          ▶ Test voce
        </Btn>
      </section>
    </div>
  );
}

function BlipsFields() {
  const { s, patch } = useSet();
  const b = s.tts.blips;
  const setB = (p: Partial<S['tts']['blips']>) => patch('tts', { blips: { ...b, ...p } });
  return (
    <div className="grid grid-cols-4 gap-3">
      <Field label="Tono blip (Hz)" type="number" value={b.pitch} onChange={(x) => setB({ pitch: Math.max(80, Math.min(2000, Number(x) || 520)) })} />
      <Select
        label="Onda"
        value={b.wave}
        onChange={(x) => setB({ wave: x as S['tts']['blips']['wave'] })}
        options={[
          { value: 'square', label: 'Square' },
          { value: 'triangle', label: 'Triangle' },
          { value: 'sawtooth', label: 'Sawtooth' },
          { value: 'sine', label: 'Sine' },
        ]}
      />
      <Field label="Volume blip 0-1" type="number" value={b.volume} onChange={(x) => setB({ volume: Math.max(0, Math.min(1, Number(x))) })} />
      <Field label="Variazione 0-0.3" type="number" value={b.variance} onChange={(x) => setB({ variance: Math.max(0, Math.min(0.3, Number(x))) })} />
    </div>
  );
}

/** Scarica il modello whisper piccolo (base q5_1) accanto a quello principale. */
function FastModelDownload() {
  const { s, patch } = useSet();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Btn
        variant="ghost"
        disabled={busy || !s.stt.whisperModel}
        onClick={async () => {
          setBusy(true);
          setMsg('');
          try {
            const m = s.stt.whisperModel;
            const dir = m.slice(0, m.length - (m.split(/[\\/]/).pop() ?? '').length);
            const dest = dir + 'ggml-base-q5_1.bin';
            await invoke('download_file', { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin', dest });
            patch('stt', { fastModel: dest });
            await ensureWhisper();
            setMsg('OK: ' + dest);
          } catch (e) {
            setMsg(String(e instanceof Error ? e.message : e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '…' : '↓ base q5_1 (57 MB)'}
      </Btn>
      {msg && <span className="font-mono text-[12px] text-cyan">{msg}</span>}
    </div>
  );
}

// ================================================================ ASCOLTO

function ListenTab() {
  const { s, patch } = useSet();
  const ready = useApp((x) => x.status.sttReady);
  return (
    <div className="flex flex-col gap-3">
      <H n="08">Speech-to-text</H>
      <Select
        label="Modalità"
        value={s.stt.mode}
        onChange={(x) => patch('stt', { mode: x as S['stt']['mode'] })}
        options={[
          { value: 'whisper', label: 'Whisper locale (fallback cloud)' },
          { value: 'cloud', label: 'Solo cloud (Gemini)' },
          { value: 'off', label: 'Disattivato' },
        ]}
      />
      <PathField label="whisper-server.exe" value={s.stt.whisperExe} onChange={(x) => patch('stt', { whisperExe: x })} ext={['exe']} />
      <PathField label="Modello whisper (ggml-*.bin)" value={s.stt.whisperModel} onChange={(x) => patch('stt', { whisperModel: x })} ext={['bin']} />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Porta" type="number" value={s.stt.port} onChange={(x) => patch('stt', { port: Number(x) || 8178 })} />
        <Field label="Thread CPU" type="number" value={s.stt.threads} onChange={(x) => patch('stt', { threads: Number(x) || 4 })} />
        <Field label="Lingua (it, en, pl, ja, auto)" value={s.stt.language} onChange={(x) => patch('stt', { language: x })} />
      </div>
      <Toggle label="Avvia whisper-server con l'app" on={s.stt.autoStart} onChange={(x) => patch('stt', { autoStart: x })} />
      <Toggle label="Ascolto continuo (VAD)" hint="Altrimenti push-to-talk con la hotkey" on={s.stt.continuous} onChange={(x) => patch('stt', { continuous: x })} />
      <Field
        label="Soglia VAD (0.005 - 0.08)"
        type="number"
        value={s.stt.vadThreshold}
        onChange={(x) => patch('stt', { vadThreshold: Number(x) || 0.02 })}
      />
      <Field label="Hotkey push-to-talk (tieni premuto)" value={s.hotkey} onChange={(x) => patch('hotkey', x)} hint="Formato: CommandOrControl+Shift+W. Riavvia l'app dopo la modifica." />
      <H n="08b">Latenza</H>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Fine frase dopo (ms di silenzio)"
          type="number"
          value={s.stt.silenceMs}
          onChange={(x) => patch('stt', { silenceMs: Math.max(250, Math.min(2000, Number(x) || 550)) })}
          hint="Più basso = risponde prima (350-600 consigliato)"
        />
        <Field
          label="Ascolto passivo: frasi max (s)"
          type="number"
          value={s.stt.maxPassiveSec}
          onChange={(x) => patch('stt', { maxPassiveSec: Math.max(2, Math.min(30, Number(x) || 6)) })}
          hint="Le frasi più lunghe (chiacchiere) non vengono trascritte"
        />
      </div>
      <PathField label="Modello veloce per comandi e parola di attivazione (opzionale)" value={s.stt.fastModel} onChange={(x) => patch('stt', { fastModel: x })} ext={['bin']} />
      <FastModelDownload />
      <p className="m-0 text-[14px] text-muted">
        I comandi rapidi (clip, DJ mode, search mode, musica, apri app, YouTube, Google) partono subito dopo la trascrizione, senza passare dall'AI. Con il modello veloce
        (base, ~60 MB) Hey Capri e "clip that" vengono riconosciuti in circa un decimo del tempo.
      </p>
      <div className="flex items-center gap-3">
        <Btn variant="cyan" onClick={() => void ensureWhisper()}>
          Avvia / verifica server
        </Btn>
        <Chip tone={ready ? 'ok' : 'idle'}>{ready ? 'WHISPER PRONTO' : 'NON ATTIVO'}</Chip>
      </div>
    </div>
  );
}

// ================================================================ VISIONE

function VisionTab() {
  const { s, patch } = useSet();
  const last = useApp((x) => x.status.lastScreen);
  return (
    <div className="flex flex-col gap-3">
      <H n="09">Visione schermo</H>
      <Toggle label="Osserva lo schermo periodicamente" on={s.vision.enabled} onChange={(x) => patch('vision', { enabled: x })} />
      <Toggle label="Commenti spontanei" hint="Reagisce a ciò che vede" on={s.vision.react} onChange={(x) => patch('vision', { react: x })} />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Intervallo (s)" type="number" value={s.vision.intervalSec} onChange={(x) => patch('vision', { intervalSec: Math.max(10, Number(x) || 45) })} />
        <Field label="Pausa min. tra commenti (s)" type="number" value={s.vision.minReactGapSec} onChange={(x) => patch('vision', { minReactGapSec: Number(x) || 120 })} />
        <Field label="Larghezza screenshot (px)" type="number" value={s.vision.maxWidth} onChange={(x) => patch('vision', { maxWidth: Number(x) || 1024 })} />
      </div>
      <p className="m-0 text-[14px] text-muted">L'overlay è escluso dagli screenshot. Le immagini restano in memoria e vanno al cloud solo se il modello locale fallisce.</p>
      <Btn variant="cyan" onClick={() => void visionTick(true)}>
        Guarda ora
      </Btn>
      {last && <div className="border border-edge bg-panel p-3 font-mono text-[12px] text-muted">ULTIMA OSSERVAZIONE: {last}</div>}
    </div>
  );
}

// ================================================================ LOCALE

function LocalTab() {
  const { s, patch } = useSet();
  const [models, setModels] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const load = async () => {
    setErr('');
    try {
      setModels(await listModels(s.local.baseUrl, s.local.apiKey));
    } catch (e) {
      setErr(String(e));
    }
  };
  const move = (i: number, d: number) => {
    const o = [...s.order];
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    patch('order', o as ProviderId[]);
  };
  const names: Record<ProviderId, string> = { local: 'Locale', gemini: 'Gemini multi-key', extra: 'Altri provider free (Groq, Cerebras…)', openrouter: 'OpenRouter free' };
  return (
    <div className="flex flex-col gap-3">
      <H n="10">Ordine provider</H>
      {s.order.map((p, i) => (
        <div key={p} className="flex items-center gap-2 border border-edge bg-panel/60 px-3 py-1">
          <span className="w-6 font-mono text-yellow">{i + 1}</span>
          <span className="flex-1 font-semibold">{names[p]}</span>
          <Btn variant="ghost" aria-label="Su" onClick={() => move(i, -1)}>
            ↑
          </Btn>
          <Btn variant="ghost" aria-label="Giù" onClick={() => move(i, 1)}>
            ↓
          </Btn>
        </div>
      ))}
      <H n="11">Server locale (OpenAI compatibile)</H>
      <Toggle label="Usa AI locale" on={s.local.enabled} onChange={(x) => patch('local', { enabled: x })} />
      <div className="flex gap-2">
        <Btn variant="ghost" onClick={() => patch('local', { baseUrl: 'http://127.0.0.1:11434/v1' })}>
          Ollama
        </Btn>
        <Btn variant="ghost" onClick={() => patch('local', { baseUrl: 'http://127.0.0.1:1234/v1' })}>
          LM Studio
        </Btn>
      </div>
      <Field label="Base URL" value={s.local.baseUrl} onChange={(x) => patch('local', { baseUrl: x })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Modello chat" value={s.local.chatModel} onChange={(x) => patch('local', { chatModel: x })} hint="es. qwen2.5:7b, llama3.1:8b" />
        <Field label="Modello visione" value={s.local.visionModel} onChange={(x) => patch('local', { visionModel: x })} hint="es. gemma3:4b, moondream" />
        <Field label="Timeout (s)" type="number" value={s.local.timeoutSec} onChange={(x) => patch('local', { timeoutSec: Number(x) || 90 })} />
        <Field label="Limite VRAM avviso (GB)" type="number" value={s.local.vramCapGb} onChange={(x) => patch('local', { vramCapGb: Number(x) || 6.5 })} />
      </div>
      <div className="flex items-center gap-3">
        <Btn variant="cyan" onClick={() => void load()}>
          Carica modelli installati
        </Btn>
        {err && <Chip tone="error">server non raggiungibile</Chip>}
      </div>
      {!!models.length && (
        <div className="flex flex-wrap gap-2">
          {models.map((m) => (
            <span key={m} className="flex items-center gap-1 border border-edge px-2 py-1 font-mono text-[12px]">
              {m}
              <button type="button" className="cursor-pointer text-yellow" onClick={() => patch('local', { chatModel: m })}>
                [chat]
              </button>
              <button type="button" className="cursor-pointer text-cyan" onClick={() => patch('local', { visionModel: m })}>
                [vis]
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ================================================================ CLOUD

function CloudTab() {
  const { s, patch } = useSet();
  const [bulk, setBulk] = useState('');
  const [, force] = useState(0);
  const [free, setFree] = useState<{ id: string; vision: boolean }[]>([]);
  useEffect(() => {
    const t = window.setInterval(() => force((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const addKeys = () => {
    const keys = bulk
      .split(/[\s,;]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 20 && !s.gemini.keys.some((x) => x.key === k));
    if (!keys.length) return;
    patch('gemini', {
      keys: [...s.gemini.keys, ...keys.map((key, i) => ({ id: uid(), label: `key ${s.gemini.keys.length + i + 1}`, key, enabled: true }))],
    });
    setBulk('');
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3">
        <H n="12">Gemini · rotazione multi-key</H>
        <Toggle label="Usa Gemini" on={s.gemini.enabled} onChange={(x) => patch('gemini', { enabled: x })} />
        {s.gemini.keys.map((k, i) => {
          const st = geminiKeyStatus(k.id);
          return (
            <div key={k.id} className="flex items-center gap-2 border border-edge bg-panel/60 p-2">
              <input
                aria-label="Etichetta key"
                value={k.label}
                onChange={(e) => patch('gemini', { keys: s.gemini.keys.map((x) => (x.id === k.id ? { ...x, label: e.target.value } : x)) })}
                className="h-9 w-28 border border-edge bg-void px-2 text-[12px]"
              />
              <span className="flex-1 font-mono text-[12px] text-muted">
                {k.key.slice(0, 6)}••••{k.key.slice(-4)}
              </span>
              <Chip tone={st.tone}>{st.label}</Chip>
              <Btn
                variant={k.enabled ? 'outline' : 'ghost'}
                onClick={() => patch('gemini', { keys: s.gemini.keys.map((x) => (x.id === k.id ? { ...x, enabled: !x.enabled } : x)) })}
              >
                {k.enabled ? 'ON' : 'OFF'}
              </Btn>
              <Btn variant="danger" aria-label={`Elimina key ${i + 1}`} onClick={() => patch('gemini', { keys: s.gemini.keys.filter((x) => x.id !== k.id) })}>
                ✕
              </Btn>
            </div>
          );
        })}
        <label htmlFor="bulk" className="font-mono text-[11px] tracking-[1px] text-muted uppercase">
          Aggiungi key (una o più, separate da spazio o a capo)
        </label>
        <textarea id="bulk" rows={3} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="AIza…" className="border border-edge bg-panel p-2 text-[13px]" />
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" onClick={addKeys}>
            + Aggiungi key
          </Btn>
          <Btn variant="ghost" onClick={resetGeminiKeys}>
            Reset cooldown
          </Btn>
          <Btn
            variant="cyan"
            disabled={!s.gemini.keys.length}
            onClick={async () => {
              try {
                const m = await listGeminiModels(s.gemini.keys[0].key);
                log('info', 'gemini', `modelli: ${m.filter((x) => x.includes('flash')).join(', ')}`);
              } catch (e) {
                log('error', 'gemini', String(e));
              }
            }}
          >
            Elenca modelli (vedi Log)
          </Btn>
        </div>
        <Field
          label="Modelli Gemini in ordine (separati da virgola)"
          value={s.gemini.models.join(', ')}
          onChange={(x) => patch('gemini', { models: x.split(',').map((m) => m.trim()).filter(Boolean) })}
        />
        <Field label="Cooldown dopo 429 (s)" type="number" value={s.gemini.cooldownSec} onChange={(x) => patch('gemini', { cooldownSec: Number(x) || 60 })} />
      </section>

      <section className="flex flex-col gap-3">
        <H n="13">OpenRouter · solo modelli gratuiti</H>
        <Toggle label="Usa OpenRouter come ultimo fallback" on={s.openrouter.enabled} onChange={(x) => patch('openrouter', { enabled: x })} />
        <Field label="OpenRouter API key" type="password" value={s.openrouter.key} onChange={(x) => patch('openrouter', { key: x })} />
        <Btn
          variant="cyan"
          onClick={async () => {
            try {
              setFree(await openRouterFreeModels(true));
            } catch (e) {
              log('error', 'openrouter', String(e));
            }
          }}
        >
          Aggiorna lista modelli free
        </Btn>
        {!!free.length && (
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto border border-edge p-2">
            {free.map((m) => {
              const on = s.openrouter.preferred.includes(m.id);
              return (
                <label key={m.id} className="flex cursor-pointer items-center gap-2 font-mono text-[12px]">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      patch('openrouter', {
                        preferred: on ? s.openrouter.preferred.filter((x) => x !== m.id) : [...s.openrouter.preferred, m.id],
                      })
                    }
                  />
                  {m.id} {m.vision && <span className="text-cyan">[vision]</span>}
                </label>
              );
            })}
          </div>
        )}
        <p className="m-0 text-[13px] text-dim">Preferiti spuntati = provati per primi. Solo id con prezzo 0 o suffisso :free.</p>
      </section>
    </div>
  );
}


// ================================================================ API FREE / STRUMENTI / HEY CAPRI

function FreeTab() {
  const { s, patch } = useSet();
  const [st, setSt] = useState<Record<string, { tone: 'ok' | 'error' | 'idle'; label: string }>>({});
  const upd = (i: number, p: Partial<S['extra'][number]>) => patch('extra', s.extra.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="flex flex-col gap-4">
      <H n="16">Altri provider gratuiti</H>
      <p className="m-0 text-[14px] text-muted">
        Usati dopo Gemini e prima di OpenRouter (ordine nella scheda AI locale). Basta incollare la key: senza key il provider viene saltato. Se un modello
        sparisce, premi "Modelli" (lista nel Log) e aggiorna il campo.
      </p>
      {s.extra.map((pv, i) => {
        const cd = (providerCd.get(pv.id) ?? 0) > Date.now();
        return (
          <section key={pv.id} className="flex flex-col gap-2 border border-edge bg-panel/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-[13px] font-bold tracking-[2px] text-yellow italic">{pv.name}</span>
              <Chip tone={cd ? 'warn' : pv.key ? 'ok' : 'idle'}>{cd ? 'IN PAUSA' : pv.key ? 'ATTIVO' : 'SENZA KEY'}</Chip>
            </div>
            <Toggle label="Usa questo provider" on={pv.enabled} onChange={(v) => upd(i, { enabled: v })} />
            <Field label={`API key · ${pv.signup}`} type="password" value={pv.key} onChange={(v) => upd(i, { key: v.trim() })} />
            <Field label="Base URL" value={pv.base} onChange={(v) => upd(i, { base: v.trim() })} />
            <Field label="Modelli chat (in ordine)" value={pv.models} onChange={(v) => upd(i, { models: v })} />
            <Field label="Modelli visione (opzionale)" value={pv.vision} onChange={(v) => upd(i, { vision: v })} />
            <div className="flex flex-wrap items-center gap-2">
              <Btn
                variant="cyan"
                disabled={!pv.key}
                onClick={async () => {
                  const m = pv.models.split(',')[0].trim();
                  setSt((x) => ({ ...x, [pv.id]: { tone: 'idle', label: '…' } }));
                  try {
                    const t = await testChat(pv.base, pv.key.trim(), m);
                    setSt((x) => ({ ...x, [pv.id]: { tone: 'ok', label: `OK · ${m} · ${t.slice(0, 16)}` } }));
                  } catch (e) {
                    setSt((x) => ({ ...x, [pv.id]: { tone: 'error', label: String(e instanceof Error ? e.message : e).slice(0, 70) } }));
                  }
                }}
              >
                Prova
              </Btn>
              <Btn
                variant="ghost"
                onClick={async () => {
                  try {
                    const ids = await listModels(pv.base, pv.key.trim());
                    log('info', pv.id, `modelli: ${ids.slice(0, 60).join(', ')}`);
                    setSt((x) => ({ ...x, [pv.id]: { tone: 'ok', label: `${ids.length} modelli (vedi Log)` } }));
                  } catch (e) {
                    setSt((x) => ({ ...x, [pv.id]: { tone: 'error', label: String(e).slice(0, 70) } }));
                  }
                }}
              >
                Modelli
              </Btn>
              {st[pv.id] && <Chip tone={st[pv.id].tone}>{st[pv.id].label}</Chip>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ToolsTab() {
  const { s, patch } = useSet();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [cmd, setCmd] = useState('');
  const t = s.tools;
  const setT = (p: Partial<S['tools']>) => patch('tools', p);
  return (
    <div className="flex flex-col gap-4">
      <section>
        <H n="17">Azioni sul PC</H>
        <Toggle label="Strumenti attivi" on={t.on} onChange={(v) => setT({ on: v })} />
        <Toggle label="Apri app" hint='"apri Discord", "apri Spotify"' on={t.apps} onChange={(v) => setT({ apps: v })} />
        <Toggle label="Ricerca web e risposta" hint='"chi ha vinto ieri?"' on={t.web} onChange={(v) => setT({ web: v })} />
        <Toggle label="Leggi lo schermo" hint='"cosa c’è scritto qui?", "spiegami questo errore" — OCR di Windows + screenshot' on={t.screen} onChange={(v) => setT({ screen: v })} />
        <Toggle label="Chiamate e WhatsApp" hint='"chiama Marco", "scrivi a Marco su WhatsApp che arrivo"' on={t.calls} onChange={(v) => setT({ calls: v })} />
        <p className="m-0 mt-2 text-[14px] text-muted">
          YouTube e Google si aprono nel browser predefinito. Le chiamate usano il link <b>tel:</b>: con <b>Collegamento al telefono</b> di Windows
          associato al cellulare partono dal telefono. WhatsApp apre la chat in WhatsApp Desktop (la chiamata si avvia dal pulsante in alto). L’OCR usa
          la lingua installata in Windows.
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <H n="18">Contatti per Capri ({s.contacts.length})</H>
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field label="Nome" value={name} onChange={setName} placeholder="Marco" />
          <Field label="Numero" value={phone} onChange={setPhone} placeholder="+39 333 1234567" />
          <Btn
            variant="primary"
            disabled={!name.trim() || phone.replace(/[^0-9]/g, '').length < 6}
            onClick={() => {
              patch('contacts', [...s.contacts, { id: uid(), name: name.trim(), phone: phone.trim() }]);
              setName('');
              setPhone('');
            }}
          >
            + Aggiungi
          </Btn>
        </div>
        {s.contacts.map((c) => (
          <div key={c.id} className="flex items-center gap-2 border border-edge bg-panel/60 px-3 py-1">
            <span className="flex-1 text-[15px]">{c.name}</span>
            <span className="font-mono text-[12px] text-muted">{c.phone}</span>
            <button type="button" aria-label={`Rimuovi ${c.name}`} className="h-8 w-8 cursor-pointer text-red" onClick={() => patch('contacts', s.contacts.filter((x) => x.id !== c.id))}>
              ✕
            </button>
          </div>
        ))}
      </section>
      <section className="flex items-end gap-2">
        <Field className="flex-1" label="Prova un comando" value={cmd} onChange={setCmd} placeholder="apri Discord · cerca lo-fi su YouTube · leggi lo schermo" />
        <Btn
          variant="cyan"
          disabled={!cmd.trim()}
          onClick={() => {
            void ask(cmd);
            setCmd('');
          }}
        >
          Invia
        </Btn>
      </section>
    </div>
  );
}

function PassiveTab() {
  const { s, patch } = useSet();
  const p = s.passive;
  return (
    <div className="flex flex-col gap-3">
      <H n="19">Assistente passivo · Hey Capri</H>
      <p className="m-0 text-[14px] text-muted">
        Capri ascolta in continuo con whisper locale (CPU, niente cloud) e reagisce solo alle frasi che contengono la parola di attivazione. Se dici solo
        “Hey Capri” ti chiede di cosa hai bisogno e ascolta la frase successiva; puoi anche dire tutto insieme: “Hey Capri, apri Spotify”. La hotkey e il
        click sul sigillo funzionano sempre senza parola di attivazione.
      </p>
      <Toggle label="Modalità passiva" on={p.on} onChange={(v) => patch('passive', { on: v })} />
      <Field label="Parole di attivazione (separate da virgola)" value={p.words} onChange={(v) => patch('passive', { words: v })} hint='Basta anche solo "capri" se whisper la sente chiaramente.' />
      <Field label="Frase di risposta" value={p.greeting} onChange={(v) => patch('passive', { greeting: v })} placeholder="Dimmi, choom. Di cosa hai bisogno?" />
      <Field
        label="Soglia VAD (0.005 - 0.08, più alta = meno rumori)"
        type="number"
        value={s.stt.vadThreshold}
        onChange={(v) => patch('stt', { vadThreshold: Number(v) || 0.02 })}
      />
      <p className="m-0 text-[13px] text-dim">Richiede whisper-server attivo (scheda Ascolto). Ogni frase captata viene trascritta in locale: usa un po’ di CPU mentre parli.</p>
    </div>
  );
}

// ================================================================ MEMORIA + LOG

function MemoryTab() {
  const facts = useApp((s) => s.facts);
  const addFact = useApp((s) => s.addFact);
  const removeFact = useApp((s) => s.removeFact);
  const clearFacts = useApp((s) => s.clearFacts);
  const [t, setT] = useState('');
  return (
    <div className="flex flex-col gap-3">
      <H n="14">Memoria persistente ({facts.length})</H>
      <div className="flex items-end gap-2">
        <Field className="flex-1" label="Aggiungi fatto" value={t} onChange={setT} placeholder="es. Lavoro su un computer Z80 homebrew" />
        <Btn
          variant="primary"
          onClick={() => {
            addFact(t);
            setT('');
          }}
        >
          Salva
        </Btn>
      </div>
      <div className="flex flex-col gap-1">
        {facts.map((f) => (
          <div key={f.id} className="flex items-center gap-2 border border-edge bg-panel/60 px-3 py-1">
            <span className="flex-1 text-[15px]">{f.text}</span>
            <span className="font-mono text-[10px] text-dim">{new Date(f.ts).toLocaleDateString('it-IT')}</span>
            <button type="button" aria-label="Dimentica" className="h-8 w-8 cursor-pointer text-red" onClick={() => removeFact(f.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Btn variant="ghost" onClick={resetConversation}>
          Nuova conversazione
        </Btn>
        <Btn variant="danger" disabled={!facts.length} onClick={clearFacts}>
          Cancella tutta la memoria
        </Btn>
      </div>
    </div>
  );
}

function LogTab() {
  const logs = useApp((s) => s.logs);
  const color = { info: 'text-muted', ok: 'text-ok', warn: 'text-warn', error: 'text-red' };
  return (
    <div className="flex flex-col gap-2">
      <H n="15">Log provider e servizi</H>
      <div className="flex max-h-[60vh] flex-col-reverse overflow-y-auto border border-edge bg-void p-3 font-mono text-[12px] leading-relaxed">
        {[...logs].reverse().map((l) => (
          <div key={l.id}>
            <span className="text-dim">{new Date(l.ts).toLocaleTimeString('it-IT')}</span> <span className={color[l.level]}>[{l.src.toUpperCase()}]</span>{' '}
            <span className="text-fg/90">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Scarica le voci Piper italiana, inglese e polacca accanto a quella predefinita. */
function PiperLangVoices() {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(
        [
          ['it', 'IT · paola'],
          ['en', 'EN · amy'],
          ['pl', 'PL · gosia'],
        ] as const
      ).map(([l, label]) => (
        <Btn
          key={l}
          variant="ghost"
          disabled={!!busy}
          onClick={async () => {
            setBusy(l);
            setMsg('');
            try {
              const p = await downloadPiperVoice(l);
              setMsg('OK: ' + p);
            } catch (e) {
              setMsg(String(e instanceof Error ? e.message : e));
            } finally {
              setBusy('');
            }
          }}
        >
          {busy === l ? '…' : '↓ ' + label}
        </Btn>
      ))}
      <span className="text-[13px] text-dim">Scarica la voce Piper della lingua: viene scelta da sola in base alla lingua.</span>
      {msg && <span className="w-full font-mono text-[12px] text-cyan">{msg}</span>}
    </div>
  );
}

// ================================================================ PANNELLO

export function SettingsPanel() {
  const ref = useHitRef('settings');
  const tab = useApp((s) => s.settingsTab);
  const setPanel = useApp((s) => s.setPanel);
  const body = {
    capri: <ModeTab />,
    avatar: <AvatarTab />,
    persona: <PersonaTab />,
    voce: <VoiceTab />,
    ascolto: <ListenTab />,
    visione: <VisionTab />,
    locale: <LocalTab />,
    cloud: <CloudTab />,
    free: <FreeTab />,
    strumenti: <ToolsTab />,
    passivo: <PassiveTab />,
    clip: <ClipTab />,
    lovense: <LovenseTab />,
    memoria: <MemoryTab />,
    log: <LogTab />,
  }[tab] ?? <AvatarTab />;

  return (
    <motion.section
      ref={ref}
      aria-label="Impostazioni"
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      className="glass absolute top-20 left-6 flex h-[min(820px,calc(100vh-130px))] w-[min(920px,calc(100vw-48px))] border border-yellow/50"
    >
      <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-edge bg-void/70 p-3" aria-label="Sezioni">
        <div className="mb-3 font-display text-[16px] font-black tracking-[2px] text-yellow italic">SETTINGS</div>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel('settings', id)}
            className={`min-h-10 cursor-pointer px-3 text-left font-display text-[12px] font-bold tracking-[2px] uppercase ${
              tab === id ? 'cut-slab bg-yellow text-void' : 'text-muted hover:text-fg'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <Btn variant="danger" onClick={() => setPanel('none')}>
          Chiudi
        </Btn>
      </nav>
      <div className="scanlines flex-1 overflow-y-auto p-6">{body}</div>
    </motion.section>
  );
}
