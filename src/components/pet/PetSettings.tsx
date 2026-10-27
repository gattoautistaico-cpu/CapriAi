/** Impostazioni della modalità desktop pet (scheda "Desktop pet"). */
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { clearAlarms, refreshVoiceLines, syncPercent, voiceFolder } from '../../lib/pet/life';
import { L } from '../../lib/pet/lines';
import { downloadPack, importPackFolder, packReady, type PackKind } from '../../lib/pet/pack';
import { log, useApp } from '../../lib/store';
import type { PetSettings as P } from '../../lib/types';
import { Btn, Chip, Field, H, Select, Toggle } from '../ui';

const OCCASIONS = 'hello, click, pat, wake, sit, peek, stretch, look, yawn, sleep, alarm, study, dare, done, music, mischief, hop';

export function PetTab() {
  const s = useApp((st) => st.settings);
  const pet = s.pet;
  const setSettings = useApp((st) => st.setSettings);
  const profile = useApp((st) => st.profiles.find((p) => p.id === st.settings.activeProfileId) ?? st.profiles[0]);
  const updateProfile = useApp((st) => st.updateProfile);
  const set = (p: Partial<P>) => setSettings((x) => ({ ...x, pet: { ...x.pet, ...p } }));
  const [busy, setBusy] = useState<PackKind | ''>('');
  const [prog, setProg] = useState('');
  const [voices, setVoices] = useState(0);
  const [vdir, setVdir] = useState('');
  const [auto, setAuto] = useState<boolean | null>(null);

  useEffect(() => {
    void refreshVoiceLines().then(setVoices);
    void voiceFolder().then(setVdir);
    void invoke<boolean>('autostart', { on: null })
      .then(setAuto)
      .catch(() => setAuto(null));
  }, []);

  const get = async (kind: PackKind) => {
    setBusy(kind);
    try {
      await downloadPack(kind, (d, t) => setProg(`${d}/${t}`));
      log('ok', 'pet', `pacchetto ${kind} scaricato`);
    } catch (e) {
      log('error', 'pet', String(e));
    } finally {
      setBusy('');
      setProg('');
    }
  };
  const importDir = async (kind: PackKind) => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== 'string') return;
    const n = await importPackFolder(kind, dir).catch((e) => (log('error', 'pet', String(e)), 0));
    log(n ? 'ok' : 'warn', 'pet', `${n} file importati (${kind})`);
  };

  const isPet = s.ui.mode === 'pet';
  return (
    <div className="flex flex-col gap-5" data-noi18n="">
      <section className="flex flex-col gap-3">
        <H n="P0">Desktop pet</H>
        <div className="text-[14px] text-dim">
          {L(
            'Capri vive sul desktop da sola: si siede sulle finestre e le segue, si lascia trascinare e lanciare, sale sul cursore (doppio clic), sbircia dai bordi, si stiracchia, dorme, fa dispetti e commenta. Tasto destro su di lei per il menu.',
            'Capri lives on your desktop on her own: she sits on windows and follows them, can be dragged and tossed, rides your cursor (double-click), peeks from the edges, stretches, sleeps, causes mischief and comments. Right-click her for the menu.',
            'Capri żyje na pulpicie sama: siada na oknach i za nimi podąża, można ją przeciągać i rzucać, jeździ na kursorze (dwuklik), zerka zza krawędzi, przeciąga się, śpi, psoci i komentuje. Prawy przycisk na niej = menu.',
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant={isPet ? 'cyan' : 'primary'} onClick={() => setSettings((x) => ({ ...x, ui: { ...x.ui, mode: isPet ? 'capri' : 'pet' } }))}>
            {isPet ? L('Torna alla modalità Capri', 'Back to Capri overlay', 'Wróć do nakładki Capri') : L('Attiva il desktop pet', 'Turn on desktop pet', 'Włącz zwierzaka na pulpicie')}
          </Btn>
          <Chip tone={isPet ? 'ok' : 'idle'}>{isPet ? 'PET ON' : 'PET OFF'}</Chip>
          <Chip tone="cyan">SYNC {syncPercent()}%</Chip>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <H n="P1">{L('Sprite', 'Sprites', 'Sprite’y')}</H>
        <div className="border border-edge bg-panel p-3 text-[13px] text-dim">
          {L(
            'Le animazioni sono fan art di Cyberpunk: Edgerunners (© CD PROJEKT RED / Studio Trigger) create per i progetti originali: non sono incluse in Cyber AI. Puoi scaricarle dai repository degli autori (GitHub) per uso personale e non commerciale, oppure importarle da una cartella. Senza sprite il pet usa le GIF del profilo attivo.',
            'The animations are Cyberpunk: Edgerunners fan art (© CD PROJEKT RED / Studio Trigger) made for the original projects: they are not bundled with Cyber AI. You can download them from the authors’ GitHub repositories for personal, non-commercial use, or import them from a folder. Without sprites the pet uses the active profile’s GIFs.',
            'Animacje to fan art Cyberpunk: Edgerunners (© CD PROJEKT RED / Studio Trigger) z oryginalnych projektów: nie są dołączone do Cyber AI. Możesz je pobrać z repozytoriów autorów (GitHub) do użytku osobistego i niekomercyjnego albo zaimportować z folderu. Bez sprite’ów zwierzak używa GIF-ów aktywnego profilu.',
          )}
        </div>
        {(
          [
            ['strips', L('Animazioni (lachydotmcg/capri-desktop)', 'Animations (lachydotmcg/capri-desktop)', 'Animacje (lachydotmcg/capri-desktop)'), L('idle, blink, glitch, trascinata, seduta, sonno, risveglio, sorriso, bocca', 'idle, blink, glitch, dangle, perch, sleep, wake, grin, mouth', 'idle, mruganie, glitch, zwisanie, siedzenie, sen, pobudka, uśmiech, usta')],
            ['poses', L('Pose (notme71/Capri-Desktop)', 'Poses (notme71/Capri-Desktop)', 'Pozy (notme71/Capri-Desktop)'), L('stiracchiata, sguardo, sbadiglio, carezze, sonno, sbirciata, ritratti, cut-in, chip', 'stretch, look, yawn, pat, sleep, peek, portraits, cut-in, chip', 'przeciąganie, spojrzenie, ziewanie, głaskanie, sen, zerkanie, portrety, cut-in, chip')],
          ] as [PackKind, string, string][]
        ).map(([kind, label, hint]) => (
          <div key={kind} className="flex flex-wrap items-center gap-2 border-b border-dashed border-edge pb-2">
            <div className="flex min-w-[260px] flex-1 flex-col">
              <span className="text-[15px] font-semibold">{label}</span>
              <span className="text-[12px] text-dim">{hint}</span>
            </div>
            <Chip tone={packReady(kind) ? 'ok' : 'idle'}>{packReady(kind) ? L('PRONTO', 'READY', 'GOTOWE') : L('ASSENTE', 'MISSING', 'BRAK')}</Chip>
            <Btn variant="cyan" disabled={!!busy} onClick={() => void get(kind)}>
              {busy === kind ? `${L('Scarico', 'Downloading', 'Pobieram')} ${prog}` : L('Scarica', 'Download', 'Pobierz')}
            </Btn>
            <Btn variant="ghost" disabled={!!busy} onClick={() => void importDir(kind)}>
              {L('Da cartella', 'From folder', 'Z folderu')}
            </Btn>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <Select
            label={L('Figura', 'Body', 'Postać')}
            value={pet.pack}
            onChange={(v) => set({ pack: v as P['pack'] })}
            options={[
              { value: 'auto', label: L('Automatica (animazioni → pose → GIF)', 'Automatic (animations → poses → GIFs)', 'Automatycznie (animacje → pozy → GIF)') },
              { value: 'strips', label: L('Solo animazioni', 'Animations only', 'Tylko animacje') },
              { value: 'poses', label: L('Solo pose', 'Poses only', 'Tylko pozy') },
              { value: 'profile', label: L('GIF del profilo', 'Profile GIFs', 'GIF-y profilu') },
            ]}
          />
          <Select
            label={L('Taglia', 'Size', 'Rozmiar')}
            value={String(pet.size)}
            onChange={(v) => set({ size: Number(v) })}
            options={[
              { value: '170', label: L('Piccola', 'Small', 'Mała') },
              { value: '240', label: L('Media', 'Medium', 'Średnia') },
              { value: '320', label: L('Grande', 'Large', 'Duża') },
              { value: '440', label: L('Enorme', 'Huge', 'Ogromna') },
            ]}
          />
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <H n="P2">{L('Comportamento', 'Behavior', 'Zachowanie')}</H>
        <Toggle label={L('Animazioni', 'Motion', 'Animacje')} hint={L('Respiro, inclinazione, glitch. Spento = movimento ridotto.', 'Breathing, tilt, glitches. Off = reduced motion.', 'Oddech, przechylenie, glitch. Wyłączone = mniej ruchu.')} on={pet.motion} onChange={(v) => set({ motion: v })} />
        <Toggle label={L('Si siede sulle finestre', 'Sits on windows', 'Siada na oknach')} on={pet.sits} onChange={(v) => set({ sits: v })} />
        <Toggle label={L('Vagabonda tra le finestre', 'Wanders between windows', 'Wędruje między oknami')} on={pet.wander} onChange={(v) => set({ wander: v })} />
        <Toggle label={L('Sbircia dai bordi', 'Peeks from the edges', 'Zerka zza krawędzi')} hint={L('Dopo 90 s senza input.', 'After 90 s without input.', 'Po 90 s bez aktywności.')} on={pet.peeks} onChange={(v) => set({ peeks: v })} />
        <Toggle label={L('Si stiracchia, si guarda intorno, sbadiglia', 'Stretches, looks around, yawns', 'Przeciąga się, rozgląda, ziewa')} on={pet.idleActs} onChange={(v) => set({ idleActs: v })} />
        <Toggle label={L('Si addormenta', 'Falls asleep', 'Zasypia')} on={pet.sleeps} onChange={(v) => set({ sleeps: v })} />
        <Toggle label="Mischief" hint={L('Ogni tanto "hackera" lo schermo (effetti leggeri, Ctrl+Alt+C li ferma). Nuovi stili ogni 10% di sync.', 'Now and then she "hacks" the screen (gentle effects, Ctrl+Alt+C stops them). New styles every 10% of sync.', 'Czasem „hakuje” ekran (delikatne efekty, Ctrl+Alt+C zatrzymuje). Nowe style co 10% synchronizacji.')} on={pet.mischief} onChange={(v) => set({ mischief: v })} />
        <Toggle label={L('Commenti spontanei', 'Notices', 'Spontaniczne komentarze')} hint={L('Rientro dopo una pausa, notte fonda, batteria scarica, CPU al massimo, troppe ore nella stessa app.', 'Back from a break, late night, low battery, maxed CPU, hours in one app.', 'Powrót po przerwie, późna noc, słaba bateria, pełne CPU, godziny w jednej aplikacji.')} on={pet.notices} onChange={(v) => set({ notices: v })} />
        <Toggle label={L('Sfide', 'Dares', 'Wyzwania')} hint={L('"Sfidami" / "fatto" fanno salire il sync.', '"Dare me" / "done" raise the sync.', '„Rzuć mi wyzwanie” / „zrobione” podnoszą synchronizację.')} on={pet.dares} onChange={(v) => set({ dares: v })} />
        <Toggle label={L('Balla con la musica', 'Bobs to music', 'Kiwa się do muzyki')} on={pet.musicBob} onChange={(v) => set({ musicBob: v })} />
        <Toggle label={L('Commenta i brani', 'Comments on tracks', 'Komentuje utwory')} on={pet.musicComments} onChange={(v) => set({ musicComments: v })} />
        <Toggle label={L('Si nasconde a schermo intero', 'Hides in fullscreen', 'Chowa się na pełnym ekranie')} on={pet.hideFullscreen} onChange={(v) => set({ hideFullscreen: v })} />
        <Toggle label={L('Doppio clic: sale sul cursore', 'Double-click: rides the cursor', 'Dwuklik: jedzie na kursorze')} on={pet.rideCursor} onChange={(v) => set({ rideCursor: v })} />
        <div className="mt-2 grid grid-cols-4 gap-3">
          <Field label={L('Dorme dopo (s)', 'Sleeps after (s)', 'Zasypia po (s)')} type="number" value={pet.sleepAfterSec} onChange={(v) => set({ sleepAfterSec: Math.max(30, Number(v) || 180) })} />
          <Field label={L('Mischief min (s)', 'Mischief min (s)', 'Psoty min (s)')} type="number" value={pet.mischiefMinSec} onChange={(v) => set({ mischiefMinSec: Math.max(30, Number(v) || 240) })} />
          <Field label={L('Mischief max (s)', 'Mischief max (s)', 'Psoty max (s)')} type="number" value={pet.mischiefMaxSec} onChange={(v) => set({ mischiefMaxSec: Math.max(pet.mischiefMinSec, Number(v) || 600) })} />
          <Field label={L('Fumetto (s)', 'Bubble (s)', 'Dymek (s)')} type="number" value={pet.bubbleSec} onChange={(v) => set({ bubbleSec: Math.max(2, Number(v) || 7) })} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <H n="P3">{L('Scorciatoie', 'Shortcuts', 'Skróty')}</H>
        <div className="grid grid-cols-2 gap-3">
          <Field label={L('Scendi dal cursore / ferma mischief', 'Hop off / stop mischief', 'Zejdź z kursora / stop psotom')} value={pet.keys.off} onChange={(v) => set({ keys: { ...pet.keys, off: v } })} />
          <Field label={L('Scrivile', 'Type to her', 'Napisz')} value={pet.keys.talk} onChange={(v) => set({ keys: { ...pet.keys, talk: v } })} />
          <Field label={L('Parlale', 'Talk to her', 'Mów')} value={pet.keys.voice} onChange={(v) => set({ keys: { ...pet.keys, voice: v } })} />
          <Field label={L('Guarda lo schermo', 'Look at the screen', 'Spójrz na ekran')} value={pet.keys.look} onChange={(v) => set({ keys: { ...pet.keys, look: v } })} />
        </div>
        <div className="text-[12px] text-dim">
          {L('Trascinando: Shift al rilascio = si siede lì, Ctrl = resta appesa. Lanciala per farla volare.', 'While dragging: Shift on release = she sits there, Ctrl = she hangs. Toss her to make her fly.', 'Podczas przeciągania: Shift przy puszczeniu = siada tam, Ctrl = wisi. Rzuć nią, żeby poleciała.')}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <H n="P4">{L('Battute registrate', 'Voice lines', 'Nagrane kwestie')}</H>
        <div className="text-[13px] text-dim">
          {L('Metti file .wav / .mp3 nella cartella con il nome dell’occasione (es. pat.wav, pat2.wav, wake.wav). Occasioni:', 'Put .wav / .mp3 files in the folder named after the occasion (e.g. pat.wav, pat2.wav, wake.wav). Occasions:', 'Wrzuć pliki .wav / .mp3 do folderu z nazwą okazji (np. pat.wav, pat2.wav, wake.wav). Okazje:')}{' '}
          <span className="font-mono text-[12px] text-fg">{OCCASIONS}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="ghost" onClick={() => void invoke('open_path', { path: vdir })}>
            {L('Apri cartella', 'Open folder', 'Otwórz folder')}
          </Btn>
          <Btn variant="ghost" onClick={() => void refreshVoiceLines().then(setVoices)}>
            {L('Ricarica', 'Reload', 'Odśwież')}
          </Btn>
          <Chip tone={voices ? 'ok' : 'idle'}>{voices} file</Chip>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <H n="P5">{L('Sync, sveglie, avvio', 'Sync, alarms, startup', 'Synchronizacja, budziki, autostart')}</H>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="cyan">SYNC {syncPercent()}% · {pet.sync.points} pt</Chip>
          <Btn variant="danger" onClick={() => set({ sync: { points: 0, day: '', today: {}, level: 0 } })}>
            {L('Azzera sync', 'Reset sync', 'Zeruj synchronizację')}
          </Btn>
        </div>
        <div className="flex flex-col gap-1">
          {pet.alarms.length === 0 && <span className="text-[13px] text-dim">{L('Nessuna sveglia o timer.', 'No alarms or timers.', 'Brak budzików i minutników.')}</span>}
          {pet.alarms.slice(0, 12).map((a) => (
            <div key={a.id} className="flex items-center gap-2 font-mono text-[12px]">
              <span className="text-cyan">{new Date(a.at).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
              <span className="text-muted">{a.kind}</span>
              <span className="flex-1 truncate">{a.label}</span>
              <button type="button" className="cursor-pointer text-red" aria-label="×" onClick={() => set({ alarms: pet.alarms.filter((x) => x.id !== a.id) })}>
                ×
              </button>
            </div>
          ))}
          {pet.alarms.length > 0 && (
            <Btn variant="ghost" onClick={() => clearAlarms()}>
              {L('Cancella tutte', 'Clear all', 'Usuń wszystkie')}
            </Btn>
          )}
        </div>
        <Toggle
          label={L('Avvia con Windows', 'Start with Windows', 'Uruchamiaj z Windows')}
          on={!!auto}
          onChange={(v) =>
            void invoke<boolean>('autostart', { on: v })
              .then(setAuto)
              .catch((e) => log('error', 'autostart', String(e)))
          }
        />
        {profile && (
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="outline" onClick={() => updateProfile(profile.id, (p) => ({ ...p, personalityId: 'construct' }))}>
              {L('Usa la personalità "Capri (costrutto)"', 'Use the "Capri (construct)" personality', 'Użyj osobowości „Capri (konstrukt)”')}
            </Btn>
            {profile.personalityId === 'construct' && <Chip tone="ok">OK</Chip>}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <H n="P6">{L('Crediti', 'Credits', 'Autorzy')}</H>
        <div className="text-[13px] leading-relaxed text-dim">
          {L('La modalità pet unisce e rielabora:', 'Pet mode combines and reworks:', 'Tryb zwierzaka łączy i przerabia:')}
          <br />• <span className="text-fg">lachydotmcg/capri-desktop</span> — © 2026 Lachy, PolyForm Noncommercial 1.0.0
          <br />• <span className="text-fg">notme71/Capri-Desktop</span> — © 2026 vincent, MIT ({L('sulle parti aggiunte', 'for the parts it added', 'dla dodanych części')})
          <br />• {L('Ispirato al TikTok di', 'Inspired by the TikTok by', 'Inspirowane TikTokiem')} jpartnma_ · Share Tech Mono (SIL OFL 1.1)
          <br />• Capri / Cyberpunk: Edgerunners © CD PROJEKT RED / Studio Trigger — {L('progetto di fan, non ufficiale', 'unofficial fan project', 'nieoficjalny projekt fanowski')}
          <br />
          {L('Per via della licenza PolyForm Noncommercial, la build con la modalità pet è solo per uso non commerciale.', 'Because of the PolyForm Noncommercial license, builds that include pet mode are for non-commercial use only.', 'Ze względu na licencję PolyForm Noncommercial wersja z trybem zwierzaka jest tylko do użytku niekomercyjnego.')}
        </div>
      </section>
    </div>
  );
}
