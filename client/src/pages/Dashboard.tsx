import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import {
  Card,
  Empty,
  PageHeader,
  Person,
  STATUS_LABEL,
  SeverityBadge,
  Spinner,
  StatusBadge,
  cx,
  statusColor,
  tableHead,
  tableRow,
  td,
  tdNum,
  th,
  thNum,
} from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fullName, money, timeAgo } from '../lib/format';
import type { AtRiskOrder, Order, WorkflowRun } from '../lib/types';

interface DashboardData {
  kpis: { customers: number; orders: number; revenue: number; openTasks: number; atRisk: number };
  ordersByStatus: Record<string, number>;
  recentOrders: Order[];
  recentRuns: WorkflowRun[];
  atRisk: AtRiskOrder[];
}

const STATUS_ORDER = ['processing', 'on-hold', 'pending', 'completed', 'refunded', 'cancelled', 'failed'];

export function DashboardPage() {
  const { user } = useAuth();
  // Polls so webhook-driven changes appear without a page refresh.
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/dashboard'), refetchInterval: 3000 });
  if (isLoading || !data) return <Spinner />;
  const { kpis } = data;
  const totalOrders = Math.max(1, Object.values(data.ordersByStatus).reduce((a, b) => a + b, 0));

  return (
    <>
      <PageHeader title={`Good to see you, ${user?.name.split(' ')[0] ?? 'there'}`} subtitle="Live view of your WooCommerce store, updated from webhooks." />

      <section className="grid grid-cols-2 divide-zinc-100 rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] max-lg:gap-y-4 max-lg:py-4 lg:grid-cols-5 lg:divide-x">
        <Stat label="Revenue" value={money(kpis.revenue)} hint="Processing, on hold and completed" />
        <Stat label="Orders" value={kpis.orders.toLocaleString()} hint="All statuses" />
        <Stat label="Customers" value={kpis.customers.toLocaleString()} hint="Registered + guest" />
        <Stat label="Open tasks" value={kpis.openTasks.toLocaleString()} hint="Assigned to the team" />
        <Stat label="At-risk orders" value={kpis.atRisk.toLocaleString()} hint="Flagged by risk rules" tone={kpis.atRisk ? 'warn' : undefined} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Orders by status" className="lg:col-span-3">
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100">
            {STATUS_ORDER.filter((s) => data.ordersByStatus[s]).map((s) => (
              <div key={s} className={statusColor(s)} style={{ width: `${(data.ordersByStatus[s] / totalOrders) * 100}%` }} title={`${STATUS_LABEL[s]}: ${data.ordersByStatus[s]}`} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {STATUS_ORDER.filter((s) => data.ordersByStatus[s]).map((s) => (
              <Link key={s} to={`/orders?status=${s}`} className="flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900">
                <span className={cx('h-2 w-2 rounded-full', statusColor(s))} />
                {STATUS_LABEL[s]}
                <span className="num font-semibold text-zinc-900">{data.ordersByStatus[s]}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card title="Needs attention" className="lg:col-span-2" flush action={<Link to="/orders?risk=1" className="text-xs font-medium text-brand-600 hover:text-brand-700">View all</Link>}>
          {data.atRisk.length === 0 ? (
            <Empty icon={<ShieldCheck />}>No orders are at risk right now.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Customer</th>
                  <th className={th}>Order</th>
                  <th className={th}>Why</th>
                  <th className={thNum}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.atRisk.map((r) => (
                  <tr key={r.orderId} className={tableRow}>
                    <td className={td}>
                      <Link to={`/customers/${r.customer.id}`}><Person name={r.customer.name} sub={<SeverityBadge severity={r.severity} />} /></Link>
                    </td>
                    <td className={td}>
                      <Link to={`/orders/${r.orderId}`} className="num font-medium text-zinc-900 hover:text-brand-600">#{r.number}</Link>
                      <div className="mt-1"><StatusBadge status={r.status} /></div>
                    </td>
                    <td className={cx(td, 'max-w-xs text-xs text-zinc-600')}>{r.flags[0]?.reason}{r.flags.length > 1 && <span className="text-zinc-400"> +{r.flags.length - 1} more</span>}</td>
                    <td className={cx(tdNum, 'font-medium text-zinc-900')}>{money(r.total, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Automation activity" flush action={<Link to="/workflows" className="text-xs font-medium text-brand-600 hover:text-brand-700">Run log</Link>}>
          {data.recentRuns.length === 0 ? (
            <Empty>No workflow runs yet. Change an order status in the store to trigger one.</Empty>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {data.recentRuns.map((r) => (
                <li key={r.id} className="flex gap-3 px-5 py-3">
                  {r.status === 'SUCCESS' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />}
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-medium text-zinc-900">{r.workflow.name}</p>
                    <p className="text-xs text-zinc-500">{r.customer ? fullName(r.customer) : '—'} · {timeAgo(r.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent orders" className="lg:col-span-3" flush action={<Link to="/orders" className="text-xs font-medium text-brand-600 hover:text-brand-700">All orders</Link>}>
          <table className="w-full text-sm">
            <thead className={tableHead}>
              <tr>
                <th className={th}>Order</th>
                <th className={th}>Customer</th>
                <th className={th}>Status</th>
                <th className={th}>Placed</th>
                <th className={thNum}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.recentOrders.map((o) => (
                <tr key={o.id} className={tableRow}>
                  <td className={td}><Link to={`/orders/${o.id}`} className="num font-medium text-zinc-900 hover:text-brand-600">#{o.number}</Link></td>
                  <td className={td}>{o.customer && <Link to={`/customers/${o.customer.id}`}><Person name={fullName(o.customer)} size="sm" /></Link>}</td>
                  <td className={td}><StatusBadge status={o.status} /></td>
                  <td className={cx(td, 'text-zinc-500')}>{timeAgo(o.wooCreatedAt)}</td>
                  <td className={cx(tdNum, 'font-medium text-zinc-900')}>{money(o.total, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'warn' }) {
  return (
    <div className="px-5 lg:py-4">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className={cx('num mt-1 text-2xl font-semibold tracking-tight', tone === 'warn' ? 'text-amber-600' : 'text-zinc-900')}>{value}</p>
      <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>
    </div>
  );
}
