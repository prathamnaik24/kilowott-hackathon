import { env, wooStoreUrl } from '../../config/env.js';
import { invalidate } from '../../lib/cache.js';
import { prisma } from '../../lib/db.js';
import { createWooClient } from '../../integrations/woocommerce/index.js';
import type { WooCommerceClient } from '../../integrations/woocommerce/woocommerce.client.js';
import { upsertWooCustomer, upsertWooOrder } from './ingest.service.js';

let syncInFlight: Promise<SyncSummary> | null = null;

export interface SyncSummary {
  customers: number;
  orders: number;
  durationMs: number;
}

export async function getStore() {
  return prisma.store.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', name: env.WOO_STORE_URL ? 'WooCommerce store' : 'Demo store (mock WooCommerce)', url: wooStoreUrl() },
  });
}

/**
 * Full import of customers then orders (paginated). Historical imports do not fire workflows —
 * only live webhook events do — so connecting a store never spams existing customers.
 */
export function runFullSync(client: WooCommerceClient = createWooClient()): Promise<SyncSummary> {
  syncInFlight ??= doSync(client).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function doSync(client: WooCommerceClient): Promise<SyncSummary> {
  const started = Date.now();
  await getStore();
  await prisma.store.update({ where: { id: 'default' }, data: { syncStatus: 'SYNCING', syncError: null } });
  try {
    const customers = await client.fetchAll((page) => client.getCustomers(page, 50));
    for (const c of customers) await upsertWooCustomer(c);

    const orders = await client.fetchAll((page) => client.getOrders(page, 50));
    // Oldest first so status events and guest-customer creation follow real chronology.
    orders.sort((a, b) => a.date_created_gmt.localeCompare(b.date_created_gmt));
    for (const o of orders) await upsertWooOrder(o, 'SYNC');

    await prisma.store.update({
      where: { id: 'default' },
      data: { syncStatus: 'SUCCESS', lastSyncedAt: new Date() },
    });
    await invalidate();
    return { customers: customers.length, orders: orders.length, durationMs: Date.now() - started };
  } catch (error) {
    await prisma.store.update({
      where: { id: 'default' },
      data: { syncStatus: 'FAILED', syncError: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
