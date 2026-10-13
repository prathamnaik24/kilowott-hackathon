import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { env, wooStoreUrl } from './config/env.js';
import { prisma } from './lib/db.js';
import { runFullSync } from './modules/sync/sync.service.js';
import { requeueEvents } from './modules/webhooks/webhook.service.js';

async function main() {
  await bootstrap();
  const app = createApp();

  app.listen(env.PORT, async () => {
    console.log(`WooPulse API listening on http://localhost:${env.PORT}`);
    console.log(`WooCommerce store: ${wooStoreUrl()}${env.WOO_STORE_URL ? '' : ' (mock)'}`);

    // Resume any webhook events that were accepted but not processed before a restart.
    const resumed = await requeueEvents(['PENDING']);
    if (resumed) console.log(`Re-queued ${resumed} pending webhook events`);

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
