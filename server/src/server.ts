import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { env, wooStoreUrl } from './config/env.js';
import { prisma } from './lib/db.js';
import { redisEnabled } from './lib/redis.js';
import { runFullSync } from './modules/sync/sync.service.js';
import { markEventFailed, processWebhookEvent, requeueEvents } from './modules/webhooks/webhook.service.js';
import { getWebhookQueue, startBullMqWorker } from './queues/webhook-queue.js';

async function main() {
  await bootstrap();
  const app = createApp();
  const queue = getWebhookQueue();

  if (redisEnabled() && env.RUN_WORKER_IN_API) startBullMqWorker(processWebhookEvent, markEventFailed);

  app.listen(env.PORT, async () => {
    console.log(`WooPulse API listening on http://localhost:${env.PORT}`);
    console.log(`WooCommerce store: ${wooStoreUrl()}${env.WOO_STORE_URL ? '' : ' (mock)'}`);
    console.log(
      `Queue: ${queue.driver}${queue.driver === 'bullmq' ? (env.RUN_WORKER_IN_API ? ' (worker in API process)' : ' (run `npm run worker` to consume)') : ''}`,
    );

    // Resume any webhook events that were accepted but not processed before a restart.
    const resumed = await requeueEvents(['PENDING']);
    if (resumed) console.log(`Re-queued ${resumed} pending webhook events`);

    // With Redis, events accepted while Redis was down sit PENDING in the DB; sweep them back in.
    // (jobId = eventId makes re-enqueuing an already-queued event a no-op.)
    if (queue.driver === 'bullmq') {
      setInterval(() => void requeueEvents(['PENDING'], 30_000).catch(() => {}), 30_000).unref();
    }

    if (env.AUTO_SYNC_ON_BOOT && (await prisma.order.count()) === 0) {
      try {
        const summary = await runFullSync();
        console.log(`Initial sync: ${summary.customers} customers, ${summary.orders} orders in ${summary.durationMs}ms`);
      } catch (e) {
        console.error('Initial sync failed:', (e as Error).message);
      }
    }
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
