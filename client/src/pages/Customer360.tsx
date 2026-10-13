import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Bot, CheckCircle2, Circle, Mail, MapPin, Phone, Sparkles } from 'lucide-react';
import { Button, Card, Empty, ErrorNote, SeverityBadge, Spinner, StatusBadge, Tag, inputClass } from '../components/ui';
import { Timeline } from '../components/Timeline';
import { api } from '../lib/api';
import { date, fullName, money } from '../lib/format';
import type { AtRiskOrder, Customer360, CustomerInsight, TimelineItem } from '../lib/types';

export function Customer360Page() {
  const { id = '' } = useParams();
  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => api<Customer360>(`/customers/${id}`), refetchInterval: 4000 });
  const timeline = useQuery({ queryKey: ['timeline', id], queryFn: () => api<TimelineItem[]>(`/customers/${id}/timeline`), refetchInterval: 4000 });
  const risks = useQuery({ queryKey: ['customer-risks', id], queryFn: () => api<AtRiskOrder[]>(`/customers/${id}/risks`) });

  if (customer.isLoading || !customer.data) return customer.error ? <ErrorNote error={customer.error} /> : <Spinner />;
  const c = customer.data;

  return (
    <>
      <Link to="/customers" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Customers
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-violet-100 text-lg font-semibold text-violet-700">
                {c.firstName[0]}
                {c.lastName[0]}
              </div>
              <div>
                <h1 className="text-lg font-semibold text-slate-900">{fullName(c)}</h1>
                <p className="text-xs text-slate-500">{c.isGuest ? 'Guest checkout' : `WooCommerce customer #${c.wooCustomerId}`}</p>
              </div>
            </div>
            <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
              <li className="flex items-center gap-2"><Mail className="h-4 w-4 text-slate-400" /> {c.email}</li>
              {c.phone && <li className="flex items-center gap-2"><Phone className="h-4 w-4 text-slate-400" /> {c.phone}</li>}
              {c.city && <li className="flex items-center gap-2"><MapPin className="h-4 w-4 text-slate-400" /> {[c.city, c.country].filter(Boolean).join(', ')}</li>}
            </ul>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Metric label="Lifetime value" value={money(c.metrics.totalSpent)} />
              <Metric label="Orders" value={c.metrics.ordersCount} />
              <Metric label="Avg. order" value={money(c.metrics.averageOrderValue)} />
            </div>
            <TagEditor customerId={c.id} tags={c.tags} />
          </Card>

          {!!risks.data?.length && (
            <Card title="Risk flags">
              <ul className="space-y-3">
                {risks.data.flatMap((r) =>
                  r.flags.map((f) => (
                    <li key={`${r.orderId}-${f.code}`} className="text-sm">
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={f.severity} />
                        <Link to={`/orders/${r.orderId}`} className="font-medium hover:text-violet-700">#{r.number}</Link>
                      </div>
                      <p className="mt-1 text-slate-600">{f.reason}</p>
                      <p className="text-xs text-slate-500">→ {f.suggestedAction}</p>
                    </li>
                  )),
                )}
              </ul>
            </Card>
          )}

          <Card title={`Orders (${c.orders.length})`}>
            <ul className="divide-y divide-slate-100">
              {c.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <Link to={`/orders/${o.id}`} className="font-medium hover:text-violet-700">#{o.number}</Link>
                    <p className="text-xs text-slate-400">{date(o.wooCreatedAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={o.status} />
                    <span className="w-20 text-right font-medium">{money(o.total, o.currency)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <AiPanel customer={c} />
          <ActivityComposer customerId={c.id} />
          <Card title="Timeline">
            {timeline.isLoading ? <Spinner /> : timeline.data?.length ? <Timeline items={timeline.data} customerId={c.id} /> : <Empty>No activity yet.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2">
      <p className="text-sm font-semibold text-slate-900">{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

function TagEditor({ customerId, tags }: { customerId: string; tags: string[] }) {
  const qc = useQueryClient();
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: (next: string[]) => api(`/customers/${customerId}`, { method: 'PATCH', body: { tags: next } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer', customerId] }),
  });
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-1">
        {tags.map((t) => (
          <button key={t} onClick={() => save.mutate(tags.filter((x) => x !== t))} title="Remove tag">
            <Tag>{t} ×</Tag>
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) save.mutate([...tags, value.trim()]);
          setValue('');
        }}
      >
        <input className={`${inputClass} py-1 text-xs`} placeholder="Add tag…" value={value} onChange={(e) => setValue(e.target.value)} />
      </form>
    </div>
  );
}

function AiPanel({ customer }: { customer: Customer360 }) {
  const qc = useQueryClient();
  const [goal, setGoal] = useState('');
  const [tone, setTone] = useState('friendly');
  const [orderId, setOrderId] = useState('');

  const summary = useMutation({
    mutationFn: () => api<CustomerInsight>(`/ai/customers/${customer.id}/summary`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timeline', customer.id] }),
  });
  const draft = useMutation({
    mutationFn: () =>
      api<{ draftId: string; subject: string; body: string }>(`/ai/customers/${customer.id}/draft`, {
        method: 'POST',
        body: { goal: goal || 'Check in on their recent order and offer help', tone, orderId: orderId || undefined },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timeline', customer.id] }),
  });

  return (
    <Card title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-violet-500" /> AI assistant</span>}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Button variant="secondary" onClick={() => summary.mutate()} loading={summary.isPending}>
            <Bot className="h-4 w-4" /> Summarize customer
          </Button>
          <ErrorNote error={summary.error} />
          {summary.data && (
            <div className="mt-3 space-y-2 rounded-lg bg-violet-50/60 p-3 text-sm">
              <p className="text-slate-800">{summary.data.summary}</p>
              <p className="text-slate-600">{summary.data.purchaseBehavior}</p>
              {summary.data.risks.length > 0 && (
                <ul className="list-disc pl-4 text-rose-700">{summary.data.risks.map((r) => <li key={r}>{r}</li>)}</ul>
              )}
              <p className="font-medium text-violet-800">Next best action: {summary.data.nextBestAction}</p>
              <p className="text-[11px] text-slate-400">
                Sources: {summary.data.sources.join(', ') || '—'} · {summary.data.generatedBy === 'llm' ? 'LLM' : 'rules fallback'}
              </p>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <input className={inputClass} placeholder="Goal, e.g. apologise for the delay on their order" value={goal} onChange={(e) => setGoal(e.target.value)} />
          <div className="flex gap-2">
            <select className={inputClass} value={tone} onChange={(e) => setTone(e.target.value)} aria-label="Tone">
              <option value="friendly">Friendly</option>
              <option value="apologetic">Apologetic</option>
              <option value="formal">Formal</option>
              <option value="enthusiastic">Enthusiastic</option>
            </select>
            <select className={inputClass} value={orderId} onChange={(e) => setOrderId(e.target.value)} aria-label="Order">
              <option value="">No specific order</option>
              {customer.orders.map((o) => <option key={o.id} value={o.id}>#{o.number} · {o.status}</option>)}
            </select>
          </div>
          <Button onClick={() => draft.mutate()} loading={draft.isPending}>
            <Sparkles className="h-4 w-4" /> Draft follow-up email
          </Button>
          <ErrorNote error={draft.error} />
          {draft.data && <p className="text-xs text-emerald-700">Draft saved to the timeline below. Review, edit, and approve it to send.</p>}
        </div>
      </div>
    </Card>
  );
}

function ActivityComposer({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const [type, setType] = useState<'NOTE' | 'TASK'>('NOTE');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');
  const create = useMutation({
    mutationFn: () => api('/activities', { method: 'POST', body: { customerId, type, title, body, dueAt: dueAt || undefined } }),
    onSuccess: () => {
      setTitle('');
      setBody('');
      setDueAt('');
      qc.invalidateQueries({ queryKey: ['timeline', customerId] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim()) create.mutate();
  };
  return (
    <Card>
      <form onSubmit={submit} className="space-y-2">
        <div className="flex gap-1">
          {(['NOTE', 'TASK'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${type === t ? 'bg-violet-100 text-violet-700' : 'text-slate-500 hover:bg-slate-100'}`}>
              {t === 'NOTE' ? <><Circle className="mr-1 inline h-3 w-3" />Note</> : <><CheckCircle2 className="mr-1 inline h-3 w-3" />Task</>}
            </button>
          ))}
        </div>
        <input className={inputClass} placeholder={type === 'NOTE' ? 'Note title' : 'Task title'} value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className={inputClass} rows={2} placeholder="Details (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="flex items-center justify-between gap-2">
          {type === 'TASK' ? <input type="datetime-local" className={`${inputClass} max-w-56`} value={dueAt} onChange={(e) => setDueAt(e.target.value)} /> : <span />}
          <Button type="submit" size="sm" loading={create.isPending}>Add {type.toLowerCase()}</Button>
        </div>
      </form>
    </Card>
  );
}
