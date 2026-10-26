import { useEffect, useState } from 'react';
import { useHitRef } from '../lib/hit';
import { useApp } from '../lib/store';
import { Btn } from './ui';

/** Conferma chiamata con 4 s per annullare (come su Android). */
export function ConfirmCall() {
  const c = useApp((s) => s.confirm);
  const setConfirm = useApp((s) => s.setConfirm);
  const ref = useHitRef('confirm');
  const [, tick] = useState(0);

  useEffect(() => {
    if (!c) return;
    const t = window.setInterval(() => {
      if (Date.now() >= c.until) {
        window.clearInterval(t);
        setConfirm(null);
        c.run();
      } else tick((x) => x + 1);
    }, 200);
    return () => window.clearInterval(t);
  }, [c, setConfirm]);

  if (!c) return null;
  const left = Math.max(0, Math.ceil((c.until - Date.now()) / 1000));
  return (
    <div ref={ref} role="alertdialog" aria-label="Conferma chiamata" className="glass absolute top-1/2 left-1/2 w-[min(440px,90vw)] -translate-x-1/2 -translate-y-1/2 border-2 border-red p-4 shadow-[0_0_18px_rgba(255,0,60,0.45)]">
      <div className="mb-2 inline-block border border-red px-2 font-mono text-[11px] text-red">CALL // CONFIRM</div>
      <div className="mb-4 font-mono text-[17px] text-fg">{c.label}</div>
      <div className="flex justify-end gap-2">
        <Btn variant="danger" onClick={() => setConfirm(null)}>
          Annulla
        </Btn>
        <Btn
          variant="primary"
          onClick={() => {
            setConfirm(null);
            c.run();
          }}
        >
          Chiama ({left})
        </Btn>
      </div>
    </div>
  );
}
