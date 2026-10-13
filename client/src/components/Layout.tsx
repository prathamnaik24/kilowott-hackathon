import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { Activity, Bot, LayoutDashboard, LogOut, Package, RefreshCw, Search, Users, Workflow } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { timeAgo } from '../lib/format';
import { Avatar, cx } from './ui';

const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/customers', label: 'Customers', icon: Users },
      { to: '/orders', label: 'Orders', icon: Package },
    ],
  },
  {
    label: 'Automation',
    items: [
      { to: '/workflows', label: 'Workflows', icon: Workflow },
      { to: '/copilot', label: 'AI Copilot', icon: Bot },
    ],
  },
  {
    label: 'System',
    items: [{ to: '/settings', label: 'Sync health', icon: RefreshCw }],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

interface SyncPulse {
  store: { name: string; syncStatus: string };
  lastEventAt: string | null;
  eventCounts: Record<string, number>;
}

/** Small "live" indicator: green when the last sync succeeded and no webhook events are failing. */
function LiveIndicator() {
  const { data } = useQuery({ queryKey: ['store'], queryFn: () => api<SyncPulse>('/store'), refetchInterval: 5000 });
  if (!data) return null;
  const healthy = data.store.syncStatus === 'SUCCESS' && !data.eventCounts.FAILED;
  return (
    <NavLink to="/settings" className="hidden items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 sm:flex">
      <span className="relative flex h-2 w-2">
        {healthy && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={cx('relative inline-flex h-2 w-2 rounded-full', healthy ? 'bg-emerald-500' : 'bg-amber-500')} />
      </span>
      <span className="font-medium text-zinc-800">{healthy ? 'Live' : 'Attention'}</span>
      <span className="text-zinc-400">·</span>
      <span>{data.lastEventAt ? `last event ${timeAgo(data.lastEventAt)}` : 'waiting for webhooks'}</span>
    </NavLink>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/customers?search=${encodeURIComponent(q.trim())}`);
  };
  return (
    <form onSubmit={submit} className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search customers by name or email…"
        aria-label="Search customers"
        className="h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50 pr-3 pl-9 text-sm outline-none placeholder:text-zinc-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100"
      />
    </form>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-white max-md:hidden">
        <div className="flex h-14 items-center gap-2.5 border-b border-zinc-100 px-5">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-900 text-white">
            <Activity className="h-4 w-4" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-zinc-900">WooPulse</span>
          <span className="ml-auto rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">CRM</span>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1 px-3 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map(({ to, label, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
                        isActive ? 'bg-zinc-100 font-medium text-zinc-900' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cx('h-4 w-4', isActive ? 'text-brand-600' : 'text-zinc-400')} /> {label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2.5 border-t border-zinc-100 p-3">
          <Avatar name={user?.name ?? ''} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-900">{user?.name}</p>
            <p className="text-xs text-zinc-500 capitalize">{user?.role.toLowerCase()}</p>
          </div>
          <button onClick={logout} title="Sign out" className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/80 px-4 backdrop-blur md:px-8">
          <GlobalSearch />
          <div className="ml-auto">
            <LiveIndicator />
          </div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 bg-white px-3 py-2 md:hidden">
          {ALL_ITEMS.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium', isActive ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-600')}>
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
