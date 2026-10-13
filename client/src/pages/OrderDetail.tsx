import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Card, Empty, ErrorNote, SeverityBadge, Spinner, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, fullName, money } from '../lib/format';
import type { AtRiskOrder, Order, WorkflowRun } from '../lib/types';

interface OrderDetail extends Order {
  customer: NonNullable<Order['customer']> & { email: string };
  statusEvents: Array<{ id: string; previousStatus: string | null; newStatus: string; source: string; occurredAt: string }>;
  activities: Array<{ id: string; type: string; title: string; status: string | null; createdAt: string; origin: string }>;
  workflowRuns: Array<Omit<WorkflowRun, 'output' | 'customer'> & { output: string }>;
  risk: AtRiskOrder | null;
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { data: o, isLoading, error } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<OrderDetail>(`/orders/${id}`),
    refetchInterval: 3000,
  });
  if (error) return <ErrorNote error={error} />;
  if (isLoading || !o) return <Spinner />;

  return (
    <>
      <Link to="/orders" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
        <ArrowLeft className="h-4 w-4" /> Orders
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-zinc-900">Order #{o.number}</h1>
        <StatusBadge status={o.status} />
        {o.risk && <SeverityBadge severity={o.risk.severity} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {o.risk && (
            <Card title="Why this order is at risk">
              <ul className="space-y-2 text-sm">
                {o.risk.flags.map((f) => (
                  <li key={f.code}>
                    <SeverityBadge severity={f.severity} /> <span className="ml-1 text-zinc-700">{f.reason}</span>
                    <p className="ml-1 text-xs text-zinc-500">Suggested: {f.suggestedAction}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Line items">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-zinc-100">
                {o.lineItems.map((li, i) => (
                  <tr key={i}>
                    <td className="py-2">{li.name}</td>
                    <td className="text-zinc-500">× {li.quantity}</td>
                    <td className="text-right">{money(li.total, o.currency)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2">Total</td>
                  <td />
                  <td className="text-right">{money(o.total, o.currency)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
          <Card title="Automation runs for this order">
            {o.workflowRuns.length === 0 ? (
              <Empty>No workflows have run for this order.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {o.workflowRuns.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium">{r.workflow.name}</span> · <span className={r.status === 'SUCCESS' ? 'text-emerald-600' : 'text-rose-600'}>{r.status}</span>
                    <span className="ml-2 text-xs text-zinc-400">{dateTime(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Customer">
            <Link to={`/customers/${o.customer.id}`} className="font-medium text-brand-700 hover:underline">{fullName(o.customer)}</Link>
            <p className="text-sm text-zinc-500">{o.customer.email}</p>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-zinc-500">Payment</dt><dd>{o.paymentMethod}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Placed</dt><dd>{dateTime(o.wooCreatedAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Last synced</dt><dd>{dateTime(o.syncedAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Woo ID</dt><dd>{o.wooOrderId}</dd></div>
            </dl>
          </Card>
          <Card title="Status history">
            <ol className="space-y-3 border-l border-zinc-200 pl-4 text-sm">
              {o.statusEvents.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                  <div className="flex items-center gap-1.5">
                    {e.previousStatus && <><StatusBadge status={e.previousStatus} /><span className="text-zinc-400">→</span></>}
                    <StatusBadge status={e.newStatus} />
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-400">{dateTime(e.occurredAt)} · via {e.source.toLowerCase()}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
