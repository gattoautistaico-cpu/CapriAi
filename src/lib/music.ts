/**
 * Router musica: swiftFree (gratuito, sorgenti libere) o Spotify.
 * "auto" = swiftFree se risponde/configurato, altrimenti Spotify.
 */
import { control as spControl, nowPlaying as spNow, play as spPlay, type Track } from './spotify';
import { useApp } from './store';
import { swiftControl, swiftNowPlaying, swiftPlay, swiftStatus } from './swiftfree';

async function pick(): Promise<'swiftfree' | 'spotify'> {
  const m = useApp.getState().settings.music;
  if (m.provider !== 'auto') return m.provider;
  if (await swiftStatus()) return 'swiftfree';
  if (m.swiftfree.exePath) return 'swiftfree';
  return 'spotify';
}

export async function musicPlay(q: string): Promise<Track> {
  return (await pick()) === 'swiftfree' ? swiftPlay(q) : spPlay(q);
}

export async function musicControl(cmd: string): Promise<void> {
  return (await pick()) === 'swiftfree' ? swiftControl(cmd) : spControl(cmd);
}

export async function musicNowPlaying(): Promise<Track | null> {
  return (await pick()) === 'swiftfree' ? swiftNowPlaying() : spNow();
}
