import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
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
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-violet-600 text-white hover:bg-violet-700',
        variant === 'secondary' && 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        variant === 'danger' && 'bg-rose-600 text-white hover:bg-rose-700',
        className,
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  processing: 'bg-emerald-100 text-emerald-800',
  'on-hold': 'bg-amber-100 text-amber-800',
  completed: 'bg-sky-100 text-sky-800',
  cancelled: 'bg-rose-100 text-rose-700',
  refunded: 'bg-zinc-200 text-zinc-700',
  failed: 'bg-red-100 text-red-700',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600')}>
      {status}
    </span>
  );
}

const SEVERITY_STYLES = {
  high: 'bg-rose-100 text-rose-700 ring-rose-200',
  medium: 'bg-amber-100 text-amber-800 ring-amber-200',
  low: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export function SeverityBadge({ severity }: { severity: 'low' | 'medium' | 'high' }) {
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold uppercase ring-1', SEVERITY_STYLES[severity])}>{severity}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-violet-100">{children}</span>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-400">{children}</p>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{(error as Error).message}</p>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';
