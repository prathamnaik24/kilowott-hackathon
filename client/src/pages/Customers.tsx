import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Search, Users } from 'lucide-react';
import { Card, Empty, PageHeader, Person, Spinner, Tag, cx, inputClass, tableHead, tableRow, td, tdNum, th, thNum } from '../components/ui';
import { api, qs } from '../lib/api';
import { date, fullName, money } from '../lib/format';
import type { CustomerRow } from '../lib/types';

export function CustomersPage() {
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [tag, setTag] = useState('');
  const [minSpent, setMinSpent] = useState('');
  const [sort, setSort] = useState('totalSpent');

  // Keep in sync with the global search box in the top bar.
  useEffect(() => setSearch(params.get('search') ?? ''), [params]);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, tag, minSpent, sort],
    queryFn: () => api<CustomerRow[]>(`/customers${qs({ search, tag, minSpent, sort })}`),
    refetchInterval: 5000,
  });

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Registered and guest-checkout customers synced from WooCommerce. Lifetime value counts processing, on-hold and completed orders."
      />
      <Card flush>
        <div className="grid gap-3 border-b border-zinc-100 p-4 md:grid-cols-[1fr_auto_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input className={`${inputClass} pl-9`} placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className={cx(inputClass, 'md:w-36')} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
            <option value="">All tags</option>
            <option value="vip">vip</option>
            <option value="churn-risk">churn-risk</option>
          </select>
          <input className={cx(inputClass, 'md:w-32')} placeholder="Min. spend" type="number" value={minSpent} onChange={(e) => setMinSpent(e.target.value)} />
          <select className={cx(inputClass, 'md:w-40')} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
            <option value="totalSpent">Sort: Lifetime value</option>
            <option value="ordersCount">Sort: Orders</option>
            <option value="lastOrderAt">Sort: Last order</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>

        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <Empty icon={<Users />}>No customers match these filters.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={tableHead}>
                <tr>
                  <th className={th}>Customer</th>
                  <th className={th}>Location</th>
                  <th className={th}>Tags</th>
                  <th className={thNum}>Orders</th>
                  <th className={thNum}>Lifetime value</th>
                  <th className={thNum}>Last order</th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} className={tableRow}>
                    <td className={td}>
                      <Link to={`/customers/${c.id}`} className="block">
                        <Person name={fullName(c)} sub={c.isGuest ? `${c.email} · guest` : c.email} />
                      </Link>
                    </td>
                    <td className={cx(td, 'text-zinc-600')}>{[c.city, c.country].filter(Boolean).join(', ') || '—'}</td>
                    <td className={cx(td, 'space-x-1')}>{c.tags.length ? c.tags.map((t) => <Tag key={t}>{t}</Tag>) : <span className="text-zinc-300">—</span>}</td>
                    <td className={tdNum}>{c.ordersCount}</td>
                    <td className={cx(tdNum, 'font-medium text-zinc-900')}>{money(c.totalSpent)}</td>
                    <td className={cx(tdNum, 'text-zinc-500')}>{date(c.lastOrderAt)}</td>
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
