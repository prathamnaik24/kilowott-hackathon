import { prisma } from '../../lib/db.js';
import { JobQueue } from '../../lib/job-queue.js';
import type { WooCustomer, WooOrder } from '../../integrations/woocommerce/woocommerce.types.js';
import { upsertWooCustomer, upsertWooOrder } from '../sync/ingest.service.js';
import { runWorkflows } from '../workflows/workflow.engine.js';

export interface IncomingWebhook {
  deliveryId: string | null;
  topic: string;
  payload: unknown;
}

/** Single-consumer queue so events for the same order are applied in arrival order. */
export const webhookQueue = new JobQueue<string>((eventId, attempt) => processWebhookEvent(eventId, attempt), {
  maxAttempts: 3,
  backoffMs: 500,
  onFailed: async (eventId, error) => {
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) },
    });
  },
});

/**
 * Persists the raw delivery, then enqueues it. Duplicate delivery ids are acknowledged
 * without re-processing (WooCommerce retries deliveries that time out).
 */
export async function acceptWebhook(hook: IncomingWebhook): Promise<{ eventId: string; duplicate: boolean }> {
  if (hook.deliveryId) {
    const seen = await prisma.webhookEvent.findUnique({ where: { deliveryId: hook.deliveryId } });
    if (seen) return { eventId: seen.id, duplicate: true };
  }
  const resourceId = (hook.payload as { id?: unknown })?.id;
  const event = await prisma.webhookEvent.create({
    data: {
      deliveryId: hook.deliveryId,
      topic: hook.topic,
      resourceId: typeof resourceId === 'number' ? resourceId : null,
      payload: JSON.stringify(hook.payload),
    },
  });
  webhookQueue.enqueue(event.id, event.id);
  return { eventId: event.id, duplicate: false };
}

/** Worker: upsert resource → detect transitions → evaluate workflows. */
export async function processWebhookEvent(eventId: string, attempt = 1): Promise<void> {
  const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
  await prisma.webhookEvent.update({ where: { id: eventId }, data: { attempts: attempt } });
  const payload = JSON.parse(event.payload);

  let status: 'PROCESSED' | 'IGNORED' = 'PROCESSED';
  switch (event.topic) {
    case 'customer.created':
    case 'customer.updated': {
      const { customer, created } = await upsertWooCustomer(payload as WooCustomer);
      if (created) await runWorkflows({ trigger: 'CUSTOMER_CREATED', customerId: customer.id });
      break;
    }
    case 'order.created':
    case 'order.updated': {
      const result = await upsertWooOrder(payload as WooOrder, 'WEBHOOK');
      if (result.stale) {
        status = 'IGNORED';
      } else if (result.created) {
        await runWorkflows({ trigger: 'ORDER_CREATED', customerId: result.customerId, orderId: result.orderId });
      } else if (result.statusChanged) {
        await runWorkflows({
          trigger: 'ORDER_STATUS_CHANGED',
          customerId: result.customerId,
          orderId: result.orderId,
          previousStatus: result.previousStatus,
        });
      }
      break;
    }
    default:
      // customer.deleted / order.deleted and unknown topics are recorded but not applied.
      status = 'IGNORED';
  }

  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { status, error: null, processedAt: new Date() },
  });
}

/** Re-queues events left PENDING by a crash/restart, plus any FAILED ones on demand. */
export async function requeueEvents(statuses: string[] = ['PENDING']): Promise<number> {
  const events = await prisma.webhookEvent.findMany({
    where: { status: { in: statuses } },
    orderBy: { receivedAt: 'asc' },
  });
  for (const e of events) {
    await prisma.webhookEvent.update({ where: { id: e.id }, data: { status: 'PENDING' } });
    webhookQueue.enqueue(e.id, e.id);
  }
  return events.length;
}
