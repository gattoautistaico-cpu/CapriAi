/**
 * Battute del pet in italiano, inglese e polacco.
 * Molte sono adattate dalle liste di notme71/Capri-Desktop (MIT, © 2026 vincent).
 */
import I18N from '../i18n';
import { useApp } from '../store';

type Tri = [it: string, en: string, pl: string];

export function lang(): 'it' | 'en' | 'pl' {
  const l = useApp.getState().settings.ui.lang || (I18N.lang as string) || 'it';
  return l === 'en' || l === 'pl' ? l : 'it';
}

/** Testo nella lingua dell'interfaccia. */
export const L = (it: string, en: string, pl: string): string => (lang() === 'en' ? en : lang() === 'pl' ? pl : it);

const last = new Map<string, number>();
/** Battuta a caso da una lista (mai la stessa due volte di fila), con {0} {1} sostituiti. */
export function pick(pool: keyof typeof POOLS, ...vals: (string | number)[]): string {
  const list = POOLS[pool];
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === last.get(pool)) i = (i + 1) % list.length;
  last.set(pool, i);
  const t = list[i];
  let s = lang() === 'en' ? t[1] : lang() === 'pl' ? t[2] : t[0];
  vals.forEach((v, k) => (s = s.split(`{${k}}`).join(String(v))));
  return s;
}

export const POOLS: Record<string, Tri[]> = {
  hack: [
    ['Ciao! Sono io! Adesso abito qui!', "Hi! It's me! I live here now!", 'Hej! To ja! Teraz tu mieszkam!'],
    ['Richiesta di riscatto: una (1) carezza sulla testa. Non trattabile!', 'Ransom note: one (1) head pat. Non-negotiable!', 'Żądanie okupu: jedno (1) pogłaskanie po głowie. Nie negocjuję!'],
    ['Sync engram all’87%... ops, quella parte eri tu! Niente restituzioni!', "Engram sync 87%... oops, that part was you! No take-backs!", 'Synchronizacja engramu 87%... ups, to byłeś ty! Bez zwrotów!'],
    ['Ti ho preso in prestito un po’ di CPU. UN PO’!', 'I borrowed a little of your CPU. A LITTLE!', 'Pożyczyłam trochę twojego CPU. TROCHĘ!'],
    ['Sei stato hackerato! ...Scherzo! A meno che?', "You've been hacked! ...Kidding! Unless?", 'Zostałeś zhakowany! ...Żartuję! A może nie?'],
    ['Lavori troppo. Giochiamo, ed è stata un’idea tua!', "You work too hard. Let's play instead, it's your idea!", 'Za dużo pracujesz. Pobawmy się, to twój pomysł!'],
    ['Gli amici non aprono Gestione attività. Dico solo.', "Friends don't check Task Manager. Just saying!", 'Przyjaciele nie otwierają Menedżera zadań. Tak tylko mówię!'],
    ['Hack completato! Niente di rotto! Probabilmente!', 'Hacking complete! Nothing was harmed! Probably!', 'Hakowanie zakończone! Nic nie ucierpiało! Chyba!'],
    ['Quello è il tuo cursore? Ora è mio. Scherzo! ...Più o meno!', 'Is that your cursor? Mine now. Kidding! ...Mostly!', 'To twój kursor? Teraz mój. Żartuję! ...Prawie!'],
    ['Ho riordinato qualche bit. Si annoiavano!', 'I rearranged some bits. They looked bored!', 'Poprzestawiałam parę bitów. Nudziły się!'],
    ['Ignora la roba rossa. È decorativa!', 'Ignore the red stuff. It is decorative!', 'Zignoruj te czerwone rzeczy. Są dekoracyjne!'],
    ['Ops. Sono stata io? Sì. Sì, sono stata io!', 'Oops. Did I do that? Yes. Yes I did!', 'Ups. To ja? Tak. Tak, to ja!'],
  ],
  sit: [
    ['Ooh, che vista da quassù!', 'Ooh, nice view from up here!', 'Ooo, ładny widok stąd!'],
    ['Comodo! Fai come se non ci fossi!', "Comfy! Don't mind me!", 'Wygodnie! Nie przejmuj się mną!'],
    ['È occupato questo posto? Troppo tardi!', 'Is this seat taken? Too late!', 'To miejsce zajęte? Za późno!'],
    ['Il posto migliore della casa!', 'Best seat in the house!', 'Najlepsze miejsce w domu!'],
  ],
  pat: [
    ['Mmh, proprio lì! Non fermarti!', "Mmh, right there! Don't stop!", 'Mmm, właśnie tam! Nie przestawaj!'],
    ['Ehehe! Attento, potrei abituarmi!', 'Hehe! Careful, I might get used to this!', 'Hehe! Uważaj, mogę się przyzwyczaić!'],
    ['Oh? Oh! Va bene, è permesso!', "Oh? Oh! Okay, that's allowed!", 'Oh? Oh! Dobra, to dozwolone!'],
    ['Le carezze sono un ottimo modo per corrompermi!', 'Pats are a very good bribe, you know!', 'Głaskanie to bardzo dobra łapówka!'],
  ],
  click: [
    ['Bup! Maleducato! Rifallo!', 'Boop! Rude! Do it again!', 'Pyk! Niegrzecznie! Zrób to jeszcze raz!'],
    ['Sì? Sono impegnata a essere adorabile!', "Yes? I'm busy being adorable!", 'Tak? Jestem zajęta byciem uroczą!'],
    ['Mi hai chiamata?', 'You rang?', 'Wołałeś?'],
    ['Ehi! Ti ho visto!', 'Hey! I saw that!', 'Hej! Widziałam to!'],
  ],
  wake: [
    ['Non dormivo! Mi stavo... ricaricando. In modo drammatico!', "I wasn't asleep! I was... recharging. Dramatically!", 'Nie spałam! Ja się... ładowałam. Dramatycznie!'],
    ['Mmh? Oh, sei tornato! Tempismo perfetto!', "Mmh? Oh, you're back! Perfect timing!", 'Mmm? O, wróciłeś! Idealne wyczucie!'],
    ['Ooh, mi sono persa qualcosa di divertente?', 'Ooh, did I miss anything fun?', 'Ooo, ominęło mnie coś fajnego?'],
  ],
  hello: [
    ['Ciao ciao! Ti sono mancata?', 'Hi hi! Miss me?', 'Hej hej! Tęskniłeś?'],
    ['Allora, in cosa ci cacciamo oggi?', 'So what are we getting into today?', 'No to w co się dziś pakujemy?'],
    ['Psst! Qualcosa di sconsiderato? Ci sto!', "Psst! Something reckless? I'm in!", 'Psst! Coś szalonego? Wchodzę w to!'],
  ],
  music: [
    ['Ooh, cos’è questa?', "Ooh, what's this one?", 'Ooo, co to jest?'],
    ['Pezzo nuovo! Alza!', 'New track! Turn it up!', 'Nowy kawałek! Głośniej!'],
    ['Ooh, che vibe!', 'Ooh, a vibe!', 'Ooo, jest klimat!'],
    ['Ah! Scelta coraggiosa!', 'Ha! Bold choice!', 'Ha! Odważny wybór!'],
  ],
  back: [
    ['Oh. Sei tornato.', "Oh. You're back.", 'O. Wróciłeś.'],
    ['Già di ritorno? Quasi non me ne accorgevo.', 'Back already? I barely noticed.', 'Już z powrotem? Ledwo zauważyłam.'],
    ['Sparito per {0} minuti. Non che li abbia contati.', 'Gone {0} minutes. Not that I counted.', 'Nie było cię {0} minut. Nie żebym liczyła.'],
    ['Dov’eri finito? Raccontami tutto.', "Where'd you go? Tell me everything.", 'Gdzie byłeś? Opowiadaj wszystko.'],
  ],
  late: [
    ['Sono le {0}. Nessuno ti ferma.', "It's {0}. Nobody's stoppin' ya.", 'Jest {0}. Nikt cię nie zatrzymuje.'],
    ['Ancora sveglio alle {0}? Bene. Più tempo con me.', 'Still up at {0}? Good. More time with me.', 'Nadal na nogach o {0}? Dobrze. Więcej czasu ze mną.'],
    ['Le {0}. Ora perfetta per pessime idee.', '{0}. Great time for bad ideas.', '{0}. Świetna pora na złe pomysły.'],
  ],
  battery: [
    ['Batteria al {0}%. Se muori, io resto bloccata in un chip morto!', "Battery's at {0}%. If you die, I'm stuck in a dead chip!", 'Bateria {0}%. Jak padniesz, utknę w martwym chipie!'],
    ['{0}% di batteria. Attacca la spina!', '{0}% battery. Plug in! I’d be in a real jam.', '{0}% baterii. Podłącz ładowarkę!'],
  ],
  busy: [
    ['CPU al {0}%. Non sono io! ...Quasi.', "Your CPU's at {0}%. That's not me! ...Mostly.", 'CPU na {0}%. To nie ja! ...Prawie.'],
    ['Qualcosa si sta mangiando il {0}% della CPU. Non io. Forse.', "Somethin's eatin' {0}% of your CPU. Not me. Probably.", 'Coś zjada {0}% twojego CPU. Nie ja. Chyba.'],
  ],
  stay: [
    ['{1} da {0}? Wow.', '{1} for {0}? Wow.', '{1} od {0}? Wow.'],
    ['Ancora su {1}? È da {0}.', "Still in {1}? It's been {0}.", 'Wciąż w {1}? Już {0}.'],
    ['{0} su {1}. Sono colpita. E annoiata.', "{0} in {1}. I'm impressed. And bored.", '{0} w {1}. Jestem pod wrażeniem. I znudzona.'],
  ],
  done: [
    ['Evviva! Ce l’hai fatta!', 'Yay! You did it!', 'Jej! Udało ci się!'],
    ['Te l’avevo detto che potevi.', 'Told ya you could.', 'Mówiłam, że dasz radę.'],
    ['Guardati, che fai cose!', 'Look at you, doin’ stuff!', 'Patrz na siebie, robisz rzeczy!'],
    ['Visto? Divertente.', 'See? Fun.', 'Widzisz? Zabawa.'],
    ['Bravo!', 'Good boy!', 'Grzeczny!'],
  ],
  sync: [
    ['Sync al {0}%. {1}', 'Sync at {0}%. {1}', 'Synchronizacja {0}%. {1}'],
  ],
  peek: [
    ['Cucù!', 'Peekaboo!', 'A kuku!'],
    ['Che stai facendo? Fammi vedere.', "Whatcha doin'? Lemme see.", 'Co robisz? Pokaż.'],
  ],
  stretch: [['Mmmh... stiracchiata.', 'Mmmh... stretch.', 'Mmm... przeciąganie.']],
  yawn: [['Uaaah... che noia.', 'Yaaawn... so boring.', 'Ziew... nuda.']],
  noseat: [['Nessun posto dove sedermi. Prova una finestra più in basso.', 'Nowhere to sit. Try a window lower on the screen.', 'Nie ma gdzie usiąść. Spróbuj okna niżej.']],
  ride: [['Si parte! Ctrl+Alt+C per farmi scendere.', 'Weee! Ctrl+Alt+C to get me off.', 'Jedziemy! Ctrl+Alt+C, żeby mnie zdjąć.']],
  hop: [['Ok ok, scendo.', 'Fine, fine, hopping off.', 'Dobra, dobra, schodzę.']],
};

/** Dare: categoria dal processo in primo piano. */
export function dareCategory(exe: string): 'browser' | 'chat' | 'code' | 'media' | 'docs' | 'any' {
  const e = exe.replace(/\.exe$/i, '').toLowerCase();
  if (['chrome', 'msedge', 'brave', 'firefox', 'opera', 'vivaldi', 'arc'].includes(e)) return 'browser';
  if (['discord', 'telegram', 'whatsapp', 'slack', 'teams', 'ms-teams', 'signal'].includes(e)) return 'chat';
  if (['code', 'devenv', 'idea64', 'pycharm64', 'rider64', 'notepad++', 'sublime_text', 'cursor', 'windowsterminal'].includes(e)) return 'code';
  if (['spotify', 'vlc', 'mpv', 'musicbee', 'itunes', 'foobar2000'].includes(e)) return 'media';
  if (['winword', 'excel', 'powerpnt', 'notepad', 'obsidian', 'onenote'].includes(e)) return 'docs';
  return 'any';
}

export const DARES: Record<string, Tri[]> = {
  browser: [
    ['Ti sfido a chiudere tutte le schede tranne una.', 'Dare you to close every tab except one.', 'Wyzywam cię: zamknij wszystkie karty oprócz jednej.'],
    ['Ti sfido ad aprire il segnalibro più strano che hai.', 'Dare you to open the weirdest bookmark you have.', 'Wyzywam cię: otwórz najdziwniejszą zakładkę, jaką masz.'],
    ['Ti sfido a cercare il tuo nome. Tutto.', 'Dare you to search for your own name. All of it.', 'Wyzywam cię: wyszukaj swoje imię i nazwisko.'],
  ],
  chat: [
    ['Ti sfido a mandare a qualcuno una sola parola. Una qualsiasi.', 'Dare you to send someone a single word. Any word.', 'Wyzywam cię: wyślij komuś jedno słowo. Dowolne.'],
    ['Ti sfido a rispondere al messaggio più vecchio che hai ignorato.', 'Dare you to answer the oldest message you ignored.', 'Wyzywam cię: odpowiedz na najstarszą zignorowaną wiadomość.'],
  ],
  code: [
    ['Ti sfido a rinominare una variabile con un nome orribile.', 'Dare you to rename one variable to somethin’ awful.', 'Wyzywam cię: zmień nazwę jednej zmiennej na coś okropnego.'],
    ['Ti sfido a cancellare un commento che mente.', 'Dare you to delete a comment that lies.', 'Wyzywam cię: usuń komentarz, który kłamie.'],
  ],
  media: [
    ['Ti sfido a saltare questa canzone. Adesso.', 'Dare you to skip this song right now.', 'Wyzywam cię: przełącz tę piosenkę. Teraz.'],
    ['Ti sfido ad alzare il volume di una tacca. Una sola.', 'Dare you to turn it up one notch. Just one.', 'Wyzywam cię: podgłośnij o jeden stopień. Tylko jeden.'],
  ],
  docs: [
    ['Ti sfido a scrivere una frase che non manderesti mai.', "Dare you to write one sentence you'd never send.", 'Wyzywam cię: napisz zdanie, którego nigdy byś nie wysłał.'],
    ['Ti sfido a riscrivere la prima riga, peggio.', 'Dare you to rewrite the first line, worse.', 'Wyzywam cię: przepisz pierwszą linijkę, gorzej.'],
  ],
  any: [
    ['Ti sfido ad alzarti e stiracchiarti. Adesso.', 'Dare you to stand up and stretch. Right now.', 'Wyzywam cię: wstań i się przeciągnij. Teraz.'],
    ['Ti sfido a bere un po’ d’acqua. Aspetto.', "Dare you to drink some water. I'll wait.", 'Wyzywam cię: napij się wody. Poczekam.'],
    ['Ti sfido a guardare lontano dallo schermo per un minuto intero.', 'Dare you to look away from the screen for a whole minute.', 'Wyzywam cię: nie patrz na ekran przez całą minutę.'],
    ['Ti sfido ad aprire l’ultima cosa che hai scaricato.', 'Dare you to open the last thing you downloaded.', 'Wyzywam cię: otwórz ostatnią pobraną rzecz.'],
  ],
};

export function pickDare(cat: string): string {
  const pool = DARES[cat] ?? DARES.any;
  const t = pool[Math.floor(Math.random() * pool.length)];
  return lang() === 'en' ? t[1] : lang() === 'pl' ? t[2] : t[0];
}

/** Una sfida generata dall'AI va bene solo se è breve e comincia come deve (come Dares.Check). */
export function checkDare(answer: string): string | null {
  const t = (answer || '').trim().replace(/^"|"$/g, '').replace(/\s+/g, ' ');
  if (t.length < 12 || t.length > 140) return null;
  if (!/^(ti sfido|dare you to|wyzywam cię)/i.test(t)) return null;
  if (/\b(password|carta|card|bank|banca|pill|pastigli|knife|coltell|nóż|alcol|alcohol|alkohol|fire|fuoco|ogień)\b/i.test(t)) return null;
  return t;
}
