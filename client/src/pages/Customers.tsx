import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Search } from 'lucide-react';
import { Card, Empty, PageHeader, Spinner, Tag, inputClass } from '../components/ui';
import { api, qs } from '../lib/api';
import { date, fullName, money } from '../lib/format';
import type { CustomerRow } from '../lib/types';

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [minSpent, setMinSpent] = useState('');
  const [sort, setSort] = useState('totalSpent');

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, tag, minSpent, sort],
    queryFn: () => api<CustomerRow[]>(`/customers${qs({ search, tag, minSpent, sort })}`),
    refetchInterval: 5000,
  });

  return (
    <>
      <PageHeader title="Customers" subtitle="Registered and guest-checkout customers synced from WooCommerce." />
      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input className={`${inputClass} pl-9`} placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={inputClass} value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            <option value="vip">vip</option>
            <option value="churn-risk">churn-risk</option>
          </select>
          <div className="flex gap-2">
            <input className={inputClass} placeholder="Min spend" type="number" value={minSpent} onChange={(e) => setMinSpent(e.target.value)} />
            <select className={inputClass} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
              <option value="totalSpent">Top spend</option>
              <option value="ordersCount">Most orders</option>
              <option value="lastOrderAt">Recent</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <Empty>No customers match these filters.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-2">Customer</th>
                  <th>Location</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Lifetime value</th>
                  <th className="pl-4">Last order</th>
                  <th>Tags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-2.5">
                      <Link to={`/customers/${c.id}`} className="font-medium text-slate-800 hover:text-violet-700">{fullName(c)}</Link>
                      {c.isGuest && <span className="ml-1.5 text-xs text-slate-400">guest</span>}
                      <p className="text-xs text-slate-400">{c.email}</p>
                    </td>
                    <td className="text-slate-500">{[c.city, c.country].filter(Boolean).join(', ')}</td>
                    <td className="text-right">{c.ordersCount}</td>
                    <td className="text-right font-medium">{money(c.totalSpent)}</td>
                    <td className="pl-4 text-slate-500">{date(c.lastOrderAt)}</td>
                    <td className="space-x-1">{c.tags.map((t) => <Tag key={t}>{t}</Tag>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
