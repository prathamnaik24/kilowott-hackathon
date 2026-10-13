import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Card, Empty, PageHeader, SeverityBadge, Spinner, StatusBadge, inputClass } from '../components/ui';
import { api, qs } from '../lib/api';
import { date, fullName, money } from '../lib/format';
import type { AtRiskOrder, Order } from '../lib/types';

const STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'];

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const riskOnly = params.get('risk') === '1';
  const [search, setSearch] = useState('');
  const [minTotal, setMinTotal] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const orders = useQuery({
    queryKey: ['orders', status, search, minTotal, from, to],
    queryFn: () => api<Order[]>(`/orders${qs({ status, search, minTotal, from, to })}`),
    refetchInterval: 3000,
  });
  const atRisk = useQuery({ queryKey: ['at-risk'], queryFn: () => api<AtRiskOrder[]>('/orders/at-risk'), refetchInterval: 5000 });
  const riskById = new Map(atRisk.data?.map((r) => [r.orderId, r]));
  const rows = (orders.data ?? []).filter((o) => !riskOnly || riskById.has(o.id));

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  return (
    <>
      <PageHeader title="Orders" subtitle="Order tracking with live status from WooCommerce webhooks." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <FilterChip active={!status && !riskOnly} onClick={() => setParams({})}>All</FilterChip>
        <FilterChip active={riskOnly} onClick={() => setParam('risk', riskOnly ? '' : '1')}>⚠ At risk ({atRisk.data?.length ?? 0})</FilterChip>
        {STATUSES.map((s) => (
          <FilterChip key={s} active={status === s} onClick={() => setParam('status', status === s ? '' : s)}>
            <span className="capitalize">{s}</span>
          </FilterChip>
        ))}
      </div>
      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <input className={inputClass} placeholder="Search order # or customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <input className={inputClass} placeholder="Min total" type="number" value={minTotal} onChange={(e) => setMinTotal(e.target.value)} />
          <input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <input className={inputClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </div>
        {orders.isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No orders match these filters.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                <tr>
                  <th className="py-2">Order</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Payment</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((o) => {
                  const risk = riskById.get(o.id);
                  return (
                    <tr key={o.id} className="hover:bg-zinc-50">
                      <td className="py-2.5"><Link to={`/orders/${o.id}`} className="font-medium hover:text-brand-700">#{o.number}</Link></td>
                      <td>
                        {o.customer && <Link to={`/customers/${o.customer.id}`} className="hover:underline">{fullName(o.customer)}</Link>}
                        {o.customer?.isGuest && <span className="ml-1 text-xs text-zinc-400">guest</span>}
                      </td>
                      <td className="text-zinc-500">{date(o.wooCreatedAt)}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td title={risk?.flags.map((f) => f.reason).join('\n')}>{risk && <SeverityBadge severity={risk.severity} />}</td>
                      <td className="text-xs text-zinc-500">{o.paymentMethod}</td>
                      <td className="text-right font-medium">{money(o.total, o.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${active ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
    >
      {children}
    </button>
  );
}
