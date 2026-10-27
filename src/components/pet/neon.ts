/** Palette "Neon" di Capri-Desktop (nero, cremisi, verde neon, angoli tagliati). */
export const NEON = {
  void: 'rgb(7,8,13)',
  panel: 'rgb(13,15,22)',
  line: 'rgb(40,45,62)',
  crimson: 'rgb(255,20,70)',
  green: 'rgb(0,255,110)',
  blue: 'rgb(40,130,255)',
  text: 'rgb(214,224,236)',
  dim: 'rgb(96,106,122)',
};
export const FACE = "'Bahnschrift', 'Bahnschrift SemiCondensed', 'Segoe UI', sans-serif";
export const MONO = "'Share Tech Mono', 'Cascadia Mono', Consolas, monospace";

/** clip-path con angolo in alto a sinistra e in basso a destra tagliati. */
export const cut = (c: number) => `polygon(${c}px 0, 100% 0, 100% calc(100% - ${c}px), calc(100% - ${c}px) 100%, 0 100%, 0 ${c}px)`;
