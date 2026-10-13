import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Inbox, Loader2 } from 'lucide-react';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export function Card({ title, action, children, className, flush }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {action}
        </header>
      )}
      <div className={flush ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-zinc-900 text-white hover:bg-zinc-800',
        variant === 'secondary' && 'border border-zinc-200 bg-white text-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:bg-zinc-50',
        variant === 'ghost' && 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
        variant === 'danger' && 'bg-rose-600 text-white hover:bg-rose-700',
        className,
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

/** Order statuses: muted pill with a coloured dot — readable in dense tables without visual noise. */
const STATUS_DOT: Record<string, string> = {
  pending: 'bg-zinc-400',
  processing: 'bg-sky-500',
  'on-hold': 'bg-amber-500',
  completed: 'bg-emerald-500',
  cancelled: 'bg-zinc-300',
  refunded: 'bg-violet-400',
  failed: 'bg-rose-500',
};

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending payment',
  processing: 'Processing',
  'on-hold': 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  failed: 'Failed',
};

export const statusColor = (s: string) => STATUS_DOT[s] ?? 'bg-zinc-300';

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-xs font-medium text-zinc-700">
      <span className={cx('h-1.5 w-1.5 rounded-full', statusColor(status))} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const SEVERITY_STYLES = {
  high: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  medium: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  low: 'bg-zinc-50 text-zinc-600 ring-zinc-500/20',
};

export function SeverityBadge({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  return (
    <span className={cx('inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset', SEVERITY_STYLES[severity])}>
      {severity} risk
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-700">{children}</span>;
}

const AVATAR_COLORS = ['bg-sky-100 text-sky-800', 'bg-emerald-100 text-emerald-800', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-800', 'bg-indigo-100 text-indigo-800', 'bg-teal-100 text-teal-800', 'bg-orange-100 text-orange-800'];

/** Initials avatar with a colour derived from the name, so the same person always looks the same. */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
  const hash = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return (
    <span
      aria-hidden
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold',
        AVATAR_COLORS[hash % AVATAR_COLORS.length],
        size === 'sm' && 'h-6 w-6 text-[10px]',
        size === 'md' && 'h-8 w-8 text-xs',
        size === 'lg' && 'h-14 w-14 text-lg',
      )}
    >
      {initials}
    </span>
  );
}

/** Person cell used in every table: avatar + name + secondary line. */
export function Person({ name, sub, size = 'md' }: { name: ReactNode; sub?: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={typeof name === 'string' ? name : ''} size={size} />
      <span className="min-w-0">
        <span className="block truncate font-medium text-zinc-900">{name}</span>
        {sub && <span className="block truncate text-xs text-zinc-500">{sub}</span>}
      </span>
    </span>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-zinc-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-zinc-100 text-zinc-400 [&>svg]:h-4 [&>svg]:w-4">{icon ?? <Inbox />}</span>
      <p className="max-w-xs text-sm text-zinc-500">{children}</p>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{(error as Error).message}</p>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Table primitives so every list shares spacing, header style and numeric alignment. */
export const th = 'px-4 py-2.5 text-left text-xs font-medium text-zinc-500';
export const thNum = 'px-4 py-2.5 text-right text-xs font-medium text-zinc-500';
export const td = 'px-4 py-3 align-middle';
export const tdNum = 'num px-4 py-3 text-right align-middle';
export const tableHead = 'border-b border-zinc-200 bg-zinc-50/60';
export const tableRow = 'border-b border-zinc-100 last:border-0 hover:bg-zinc-50/80';

export const inputClass =
  'h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none placeholder:text-zinc-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100';
