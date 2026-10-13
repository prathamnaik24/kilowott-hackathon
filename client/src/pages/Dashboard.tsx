import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, CheckSquare, DollarSign, Package, Users, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, Empty, PageHeader, SeverityBadge, Spinner, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { fullName, money, timeAgo } from '../lib/format';
import type { AtRiskOrder, Order, WorkflowRun } from '../lib/types';

interface DashboardData {
  kpis: { customers: number; orders: number; revenue: number; openTasks: number; atRisk: number };
  ordersByStatus: Record<string, number>;
  recentOrders: Order[];
  recentRuns: WorkflowRun[];
  atRisk: AtRiskOrder[];
}

const STATUS_ORDER = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'];
const STATUS_BAR: Record<string, string> = {
  pending: 'bg-slate-400',
  processing: 'bg-emerald-500',
  'on-hold': 'bg-amber-500',
  completed: 'bg-sky-500',
  cancelled: 'bg-rose-500',
  refunded: 'bg-zinc-400',
  failed: 'bg-red-600',
};

export function DashboardPage() {
  // Polls so webhook-driven changes appear without a page refresh.
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/dashboard'),
    refetchInterval: 3000,
  });
  if (isLoading || !data) return <Spinner />;
  const { kpis } = data;
  const maxStatus = Math.max(1, ...Object.values(data.ordersByStatus));

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live view of your WooCommerce store — updates automatically from webhooks." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi icon={<Users />} label="Customers" value={kpis.customers} />
        <Kpi icon={<Package />} label="Orders" value={kpis.orders} />
        <Kpi icon={<DollarSign />} label="Revenue" value={money(kpis.revenue)} />
        <Kpi icon={<CheckSquare />} label="Open tasks" value={kpis.openTasks} />
        <Kpi icon={<AlertTriangle />} label="At-risk orders" value={kpis.atRisk} tone="rose" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="At-risk orders" className="lg:col-span-2" action={<Link to="/orders?risk=1" className="text-xs text-violet-600">View all</Link>}>
          {data.atRisk.length === 0 ? (
            <Empty>No orders at risk 🎉</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.atRisk.map((r) => (
                <li key={r.orderId} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <Link to={`/orders/${r.orderId}`} className="font-medium text-slate-800 hover:text-violet-700">#{r.number}</Link>{' '}
                      <Link to={`/customers/${r.customer.id}`} className="text-slate-500 hover:underline">{r.customer.name}</Link>{' '}
                      <StatusBadge status={r.status} />
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{r.flags.map((f) => f.reason).join(' · ')}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-medium">{money(r.total, r.currency)}</span>
                    <SeverityBadge severity={r.severity} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Orders by status">
          <div className="space-y-2">
            {STATUS_ORDER.filter((s) => data.ordersByStatus[s]).map((s) => (
              <Link key={s} to={`/orders?status=${s}`} className="block">
                <div className="flex justify-between text-xs">
                  <span className="capitalize text-slate-600">{s}</span>
                  <span className="font-medium text-slate-800">{data.ordersByStatus[s]}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div className={`h-2 rounded-full ${STATUS_BAR[s]}`} style={{ width: `${(data.ordersByStatus[s] / maxStatus) * 100}%` }} />
                </div>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Recent orders" className="lg:col-span-2">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {data.recentOrders.map((o) => (
                <tr key={o.id}>
                  <td className="py-2"><Link to={`/orders/${o.id}`} className="font-medium hover:text-violet-700">#{o.number}</Link></td>
                  <td>{o.customer && <Link to={`/customers/${o.customer.id}`} className="hover:underline">{fullName(o.customer)}</Link>}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td className="text-right font-medium">{money(o.total, o.currency)}</td>
                  <td className="text-right text-xs text-slate-400">{timeAgo(o.wooCreatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title={<span className="flex items-center gap-1.5"><Zap className="h-4 w-4 text-violet-500" /> Automation activity</span>} action={<Link to="/workflows" className="text-xs text-violet-600">Log</Link>}>
          {data.recentRuns.length === 0 ? (
            <Empty>No workflow runs yet. Change an order status in the store to trigger one.</Empty>
          ) : (
            <ul className="space-y-3">
              {data.recentRuns.map((r) => (
                <li key={r.id} className="text-sm">
                  <p className="font-medium text-slate-700">{r.workflow.name}</p>
                  <p className="text-xs text-slate-500">
                    {r.customer ? fullName(r.customer) : '—'} · {timeAgo(r.createdAt)} · <span className={r.status === 'SUCCESS' ? 'text-emerald-600' : 'text-rose-600'}>{r.status}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Kpi({ icon, label, value, tone = 'violet' }: { icon: ReactNode; label: string; value: ReactNode; tone?: 'violet' | 'rose' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`mb-2 inline-grid h-8 w-8 place-items-center rounded-lg [&>svg]:h-4 [&>svg]:w-4 ${tone === 'rose' ? 'bg-rose-50 text-rose-600' : 'bg-violet-50 text-violet-600'}`}>{icon}</div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}
