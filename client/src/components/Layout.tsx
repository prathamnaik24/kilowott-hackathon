import { NavLink, Outlet } from 'react-router';
import { Activity, Bot, LayoutDashboard, LogOut, Package, Settings, Users, Workflow } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/orders', label: 'Orders', icon: Package },
  { to: '/workflows', label: 'Workflows', icon: Workflow },
  { to: '/copilot', label: 'AI Copilot', icon: Bot },
  { to: '/settings', label: 'Sync health', icon: Settings },
];

export function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-white max-md:hidden">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-600 text-white">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-bold leading-none text-slate-900">WooPulse</p>
            <p className="text-[11px] text-slate-400">WooCommerce CRM</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-violet-50 text-violet-700' : 'text-slate-600 hover:bg-slate-50',
                )
              }
            >
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-4">
          <p className="truncate text-sm font-medium text-slate-700">{user?.name}</p>
          <p className="text-xs text-slate-400">{user?.role}</p>
          <button onClick={logout} className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden">
          {NAV.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => cx('whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium', isActive ? 'bg-violet-50 text-violet-700' : 'text-slate-600')}>
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
