import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, RotateCcw } from 'lucide-react';
import { Button, Card, Empty, ErrorNote, PageHeader, Spinner, cx } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, timeAgo } from '../lib/format';

interface StoreHealth {
  store: { name: string; url: string; syncStatus: string; syncError: string | null; lastSyncedAt: string | null };
  mode: 'live' | 'mock';
  storeUrl: string;
  mockAdminUrl: string | null;
  webhookEndpoint: string;
  queueDepth: number | null;
  queue: { driver: 'bullmq' | 'in-process'; counts: { waiting: number; active: number; delayed: number; failed: number } | null };
  cache: { driver: 'redis' | 'memory'; hits: number; misses: number };
  eventCounts: Record<string, number>;
  lastEventAt: string | null;
  recentEvents: Array<{ id: string; topic: string; resourceId: number | null; status: string; attempts: number; error: string | null; receivedAt: string }>;
}

const EVENT_STYLE: Record<string, string> = {
  PROCESSED: 'text-emerald-600',
  PENDING: 'text-amber-600',
  FAILED: 'text-rose-600',
  IGNORED: 'text-zinc-400',
};

export function SettingsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { data, isLoading } = useQuery({ queryKey: ['store'], queryFn: () => api<StoreHealth>('/store'), refetchInterval: 3000 });
  const sync = useMutation({ mutationFn: () => api('/store/sync', { method: 'POST' }), onSuccess: () => qc.invalidateQueries() });
  const retry = useMutation({ mutationFn: () => api('/store/webhooks/retry', { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['store'] }) });

  if (isLoading || !data) return <Spinner />;

  return (
    <>
      <PageHeader title="Sync health" subtitle="WooCommerce connection, initial import and real-time webhook pipeline." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Store connection">
          <dl className="space-y-2 text-sm">
            <Row label="Store">{data.store.name}</Row>
            <Row label="Mode">{data.mode === 'mock' ? 'Mock WooCommerce (demo)' : 'Live WooCommerce'}</Row>
            <Row label="REST API">{data.storeUrl}</Row>
            <Row label="Sync status">
              <span className={cx('font-medium', data.store.syncStatus === 'SUCCESS' ? 'text-emerald-600' : data.store.syncStatus === 'FAILED' ? 'text-rose-600' : 'text-amber-600')}>
                {data.store.syncStatus}
              </span>
            </Row>
            <Row label="Last full sync">{dateTime(data.store.lastSyncedAt)}</Row>
          </dl>
          {data.store.syncError && <p className="mt-2 text-xs text-rose-600">{data.store.syncError}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => sync.mutate()} loading={sync.isPending} disabled={!isAdmin}>
              <RefreshCw className="h-3.5 w-3.5" /> Full resync
            </Button>
            {data.mockAdminUrl && (
              <a href={data.mockAdminUrl} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm"><ExternalLink className="h-3.5 w-3.5" /> Open store admin</Button>
              </a>
            )}
          </div>
          <ErrorNote error={sync.error} />
        </Card>

        <Card title="Webhook pipeline">
          <dl className="space-y-2 text-sm">
            <Row label="Endpoint"><code className="text-xs">{data.webhookEndpoint}</code></Row>
            <Row label="Last event">{data.lastEventAt ? timeAgo(data.lastEventAt) : 'never'}</Row>
            <Row label="Queue">{data.queue.driver === 'bullmq' ? 'BullMQ (Redis)' : 'In-process'}</Row>
            <Row label="Queue depth">{data.queueDepth ?? 'unavailable'}</Row>
            {data.queue.counts && data.queue.driver === 'bullmq' && (
              <Row label="Jobs failed (Redis)">{data.queue.counts.failed}</Row>
            )}
            <Row label="Cache">
              {data.cache.driver === 'redis' ? 'Redis' : 'In-memory'} · {data.cache.hits} hits / {data.cache.misses} misses
              {data.cache.hits + data.cache.misses > 0 && ` (${Math.round((data.cache.hits / (data.cache.hits + data.cache.misses)) * 100)}% hit rate)`}
            </Row>
            {Object.entries(data.eventCounts).map(([k, v]) => (
              <Row key={k} label={k.toLowerCase()}><span className={EVENT_STYLE[k]}>{v}</span></Row>
            ))}
          </dl>
          <Button className="mt-4" variant="secondary" size="sm" onClick={() => retry.mutate()} loading={retry.isPending} disabled={!isAdmin || !data.eventCounts.FAILED}>
            <RotateCcw className="h-3.5 w-3.5" /> Retry failed events
          </Button>
        </Card>

        <Card title="Connect a real store">
          <ol className="list-decimal space-y-1.5 pl-4 text-sm text-zinc-600">
            <li>WooCommerce → Settings → Advanced → REST API → add a <b>Read/Write</b> key.</li>
            <li>Set <code>WOO_STORE_URL</code>, <code>WOO_CONSUMER_KEY</code>, <code>WOO_CONSUMER_SECRET</code>.</li>
            <li>Settings → Advanced → Webhooks: add <code>order.created/updated</code> and <code>customer.created/updated</code> pointing at the endpoint, with secret <code>WOO_WEBHOOK_SECRET</code>.</li>
          </ol>
        </Card>

        <Card title="Recent webhook events" className="lg:col-span-3">
          {data.recentEvents.length === 0 ? (
            <Empty>No webhook events yet.</Empty>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-400">
                <tr><th className="py-2">Received</th><th>Topic</th><th>Resource</th><th>Status</th><th>Attempts</th><th>Error</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.recentEvents.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 text-zinc-500">{dateTime(e.receivedAt)}</td>
                    <td className="font-mono text-xs">{e.topic}</td>
                    <td>{e.resourceId ?? '—'}</td>
                    <td className={cx('font-medium', EVENT_STYLE[e.status])}>{e.status}</td>
                    <td>{e.attempts}</td>
                    <td className="max-w-xs truncate text-xs text-rose-600">{e.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="capitalize text-zinc-500">{label}</dt>
      <dd className="truncate text-right text-zinc-800">{children}</dd>
    </div>
  );
}
