import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ask } from '../lib/brain';
import { useHitRef } from '../lib/hit';
import { useApp } from '../lib/store';
import { Btn } from './ui';

export function ChatPanel({ onPtt }: { onPtt: (down: boolean) => void }) {
  const ref = useHitRef('chat');
  const chat = useApp((s) => s.chat);
  const thinking = useApp((s) => s.status.thinking);
  const listening = useApp((s) => s.status.listening);
  const setPanel = useApp((s) => s.setPanel);
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [chat.length]);
  useEffect(() => input.current?.focus(), []);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    void ask(t);
  };

  return (
    <motion.section
      ref={ref}
      aria-label="Chat"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass cut-br absolute bottom-16 left-1/2 flex h-[min(520px,60vh)] w-[min(600px,90vw)] -translate-x-1/2 flex-col border border-yellow/60"
    >
      <header className="flex items-center justify-between border-b border-edge px-4 py-2">
        <span className="font-display text-[14px] font-bold tracking-[3px] text-yellow italic">CHAT</span>
        <button type="button" aria-label="Chiudi chat" onClick={() => setPanel('none')} className="h-9 w-9 cursor-pointer text-muted hover:text-red">
          ✕
        </button>
      </header>
      <div ref={list} className="scanlines flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {!chat.length && <p className="m-auto text-center text-muted">Scrivi qualcosa, oppure tieni premuto il microfono (o la hotkey) e parla.</p>}
        {chat.map((l, i) => (
          <div
            key={i}
            className={`max-w-[85%] px-3 py-2 text-[17px] leading-snug ${
              l.role === 'user' ? 'self-end border border-cyan/40 bg-cyan/10 text-right' : 'self-start border border-magenta/60 bg-panel/80'
            }`}
          >
            {l.text}
            {l.meta && <div className="mt-1 font-mono text-[10px] text-dim">{l.meta}</div>}
          </div>
        ))}
        {thinking && <div className="self-start font-mono text-[12px] text-magenta">elaborazione…</div>}
      </div>
      <form
        className="flex gap-2 border-t border-edge p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor="chat-in" className="sr-only">
          Messaggio
        </label>
        <input
          id="chat-in"
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Messaggio…"
          className="h-11 min-w-0 flex-1 border border-edge border-b-2 border-b-yellow bg-panel px-3 text-[14px] text-fg outline-none"
        />
        <button
          type="button"
          aria-label="Tieni premuto per parlare"
          onPointerDown={() => onPtt(true)}
          onPointerUp={() => onPtt(false)}
          onPointerLeave={() => listening && onPtt(false)}
          className={`h-11 w-11 cursor-pointer border ${listening ? 'border-red bg-red/20 text-red' : 'border-cyan text-cyan'}`}
        >
          ●
        </button>
        <Btn variant="primary" type="submit">
          Invia
        </Btn>
      </form>
    </motion.section>
  );
}
