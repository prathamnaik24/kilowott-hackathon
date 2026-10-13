import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CheckCircle2, XCircle, Zap } from 'lucide-react';
import { Card, Empty, PageHeader, Spinner, cx } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, fullName } from '../lib/format';
import type { Workflow, WorkflowRun } from '../lib/types';

const TRIGGER_LABEL: Record<string, string> = {
  ORDER_CREATED: 'Order created',
  ORDER_STATUS_CHANGED: 'Order status changed',
  CUSTOMER_CREATED: 'Customer created',
};

const describeAction = (a: Workflow['actions'][number]) =>
  a.type === 'SEND_EMAIL' ? `Send email “${a.subject}”` : a.type === 'CREATE_TASK' ? `Create task “${a.title}”` : `Add tag “${a.tag}”`;

export function WorkflowsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const workflows = useQuery({ queryKey: ['workflows'], queryFn: () => api<Workflow[]>('/workflows'), refetchInterval: 5000 });
  const runs = useQuery({ queryKey: ['workflow-runs'], queryFn: () => api<WorkflowRun[]>('/workflows/runs'), refetchInterval: 3000 });
  const toggle = useMutation({
    mutationFn: (w: Workflow) => api(`/workflows/${w.id}`, { method: 'PATCH', body: { isActive: !w.isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });

  return (
    <>
      <PageHeader
        title="Workflows"
        subtitle="Automations triggered by WooCommerce webhook events: trigger → conditions → actions. Every run is logged."
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {workflows.isLoading && <Spinner />}
          {workflows.data?.map((w) => (
            <Card key={w.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-zinc-800">{w.name}</h3>
                  <p className="text-sm text-zinc-500">{w.description}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={w.isActive}
                  disabled={user?.role !== 'ADMIN'}
                  title={user?.role !== 'ADMIN' ? 'Only admins can change workflows' : undefined}
                  onClick={() => toggle.mutate(w)}
                  className={cx('relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50', w.isActive ? 'bg-brand-600' : 'bg-zinc-300')}
                >
                  <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', w.isActive ? 'left-5.5' : 'left-0.5')} />
                </button>
              </div>
              <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
                <Step label="When">{TRIGGER_LABEL[w.trigger] ?? w.trigger}</Step>
                <Step label="If">
                  {w.conditions.length ? w.conditions.map((c) => `${c.field} ${c.op} ${JSON.stringify(c.value)}`).join(' AND ') : 'always'}
                </Step>
                <Step label="Then">
                  <ul>{w.actions.map((a, i) => <li key={i}>{describeAction(a)}</li>)}</ul>
                </Step>
              </div>
              <p className="mt-2 text-xs text-zinc-400">{w.runCount} runs</p>
            </Card>
          ))}
        </div>

        <Card title={<span className="flex items-center gap-1.5"><Zap className="h-4 w-4 text-brand-500" /> Execution log</span>} className="lg:col-span-2">
          {runs.isLoading ? (
            <Spinner />
          ) : !runs.data?.length ? (
            <Empty>No runs yet. Change an order status in the store admin to trigger a workflow.</Empty>
          ) : (
            <ul className="space-y-4">
              {runs.data.map((r) => (
                <li key={r.id} className="text-sm">
                  <div className="flex items-center gap-1.5">
                    {r.status === 'SUCCESS' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-rose-500" />}
                    <span className="font-medium text-zinc-800">{r.workflow.name}</span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {dateTime(r.createdAt)} ·{' '}
                    {r.customer?.id ? <Link className="hover:underline" to={`/customers/${r.customer.id}`}>{fullName(r.customer)}</Link> : '—'}
                    {r.order && <> · <Link className="hover:underline" to={`/orders/${r.order.id}`}>#{r.order.number}</Link></>}
                  </p>
                  <ul className="mt-1 space-y-0.5 pl-5 text-xs text-zinc-600">
                    {r.output.map((o, i) => (
                      <li key={i} className={o.ok ? '' : 'text-rose-600'}>• {o.detail}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Step({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-2">
      <p className="mb-0.5 font-semibold uppercase tracking-wide text-brand-600">{label}</p>
      <div className="text-zinc-700">{children}</div>
    </div>
  );
}
