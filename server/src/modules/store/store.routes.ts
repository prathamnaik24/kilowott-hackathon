import { Router } from 'express';
import { env, wooStoreUrl } from '../../config/env.js';
import { prisma } from '../../lib/db.js';
import { requireRole } from '../auth/auth.js';
import { getStore, runFullSync } from '../sync/sync.service.js';
import { requeueEvents, webhookQueue } from '../webhooks/webhook.service.js';

export const storeRouter = Router();

/** Sync health: connection info, last sync, webhook throughput and failures. */
storeRouter.get('/', async (_req, res) => {
  const store = await getStore();
  const [eventCounts, recentEvents, lastEvent] = await Promise.all([
    prisma.webhookEvent.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.webhookEvent.findMany({
      orderBy: { receivedAt: 'desc' },
      take: 25,
      select: { id: true, topic: true, resourceId: true, status: true, attempts: true, error: true, receivedAt: true, processedAt: true },
    }),
    prisma.webhookEvent.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
  ]);
  res.json({
    data: {
      store,
      mode: env.WOO_STORE_URL ? 'live' : 'mock',
      storeUrl: wooStoreUrl(),
      mockAdminUrl: env.MOCK_WOO_ENABLED ? '/mock-woo/' : null,
      webhookEndpoint: `${env.PUBLIC_URL}/api/webhooks/woocommerce`,
      queueDepth: webhookQueue.size,
      eventCounts: Object.fromEntries(eventCounts.map((e) => [e.status, e._count._all])),
      lastEventAt: lastEvent?.receivedAt ?? null,
      recentEvents,
    },
  });
});

storeRouter.post('/sync', requireRole('ADMIN'), async (_req, res) => {
  res.json({ data: await runFullSync() });
});

storeRouter.post('/webhooks/retry', requireRole('ADMIN'), async (_req, res) => {
  res.json({ data: { requeued: await requeueEvents(['FAILED']) } });
});
