import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

type Variant = 'primary' | 'outline' | 'danger' | 'cyan' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-yellow text-void hover:brightness-110',
  outline: 'border border-yellow text-yellow bg-yellow/5 hover:bg-yellow/15',
  danger: 'border border-red text-red bg-red/10 hover:bg-red/20',
  cyan: 'border border-cyan text-cyan bg-cyan/5 hover:bg-cyan/15',
  ghost: 'border border-edge text-muted bg-panel hover:text-fg hover:border-muted',
};

export function Btn({
  variant = 'outline',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`cut-sm min-h-10 px-4 font-display text-[12px] font-bold tracking-[2px] uppercase italic transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function H({ n, children }: { n?: string; children: ReactNode }) {
  return (
    <h3 className="m-0 mb-3 font-display text-[14px] tracking-[3px] text-red uppercase">
      {n ? `${n} // ` : ''}
      {children}
    </h3>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  className = '',
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="font-mono text-[11px] tracking-[1px] text-muted uppercase">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 min-w-0 border border-edge border-b-2 border-b-yellow bg-panel/80 px-3 text-[13px] text-fg outline-none focus:border-cyan"
      />
      {hint && <span className="text-[13px] text-dim">{hint}</span>}
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-mono text-[11px] tracking-[1px] text-muted uppercase">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 border border-edge bg-panel px-2 text-[13px] text-fg"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-dashed border-edge py-2">
      <div className="flex flex-col">
        <span className="text-[16px] font-semibold">{label}</span>
        {hint && <span className="text-[13px] text-dim">{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={`flex h-7 w-14 shrink-0 cursor-pointer p-[3px] border ${on ? 'justify-end border-yellow bg-yellow/15' : 'justify-start border-dim bg-panel'}`}
      >
        <span className={`block h-5 w-5 ${on ? 'bg-yellow shadow-[0_0_10px_#fcee0a]' : 'bg-dim'}`} />
      </button>
    </div>
  );
}

export function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'error' | 'idle' | 'cyan'; children: ReactNode }) {
  const c = {
    ok: 'border-ok text-ok',
    warn: 'border-warn text-warn',
    error: 'border-red text-red',
    idle: 'border-dim text-muted',
    cyan: 'border-cyan text-cyan',
  }[tone];
  return <span className={`whitespace-nowrap border px-2 py-[2px] font-mono text-[11px] ${c}`}>{children}</span>;
}
