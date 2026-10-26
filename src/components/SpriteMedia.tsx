import { fileSrc, isVideo } from '../lib/useSprite';

/** Mostra un frame sprite: immagine (png/webp/gif) o clip video (webm/mp4) in loop. */
export function SpriteMedia({ path, alt, className = '' }: { path?: string; alt: string; className?: string }) {
  if (!path) return null;
  if (isVideo(path)) {
    return (
      <video
        key={path}
        src={fileSrc(path)}
        className={className}
        autoPlay
        loop
        muted
        playsInline
        aria-label={alt}
        draggable={false}
      />
    );
  }
  return <img src={fileSrc(path)} alt={alt} className={className} draggable={false} />;
}
