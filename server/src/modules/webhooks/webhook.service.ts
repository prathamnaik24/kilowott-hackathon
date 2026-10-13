import { invalidate } from '../../lib/cache.js';
import { prisma } from '../../lib/db.js';
import { parseJson } from '../../lib/json.js';
import type { WooCustomer, WooOrder } from '../../integrations/woocommerce/woocommerce.types.js';
import { bindInProcessConsumer, getWebhookQueue } from '../../queues/webhook-queue.js';
import { upsertWooCustomer, upsertWooOrder } from '../sync/ingest.service.js';
import { runWorkflows, type TriggerEvent } from '../workflows/workflow.engine.js';

export interface IncomingWebhook {
  deliveryId: string | null;
  topic: string;
  payload: unknown;
}

/** What applying an event produced. Persisted so retries never re-derive it (AUD-002). */
interface EventOutcome {
  status: 'PROCESSED' | 'IGNORED';
  trigger: TriggerEvent | null;
}

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
  try {
    await getWebhookQueue().enqueue(event.id);
  } catch (e) {
    // Queue (Redis) unavailable: the event is safely PENDING in the database and is picked up by
    // the pending-event sweeper once the queue is back. Still acknowledge so WooCommerce doesn't disable the hook.
    console.warn(`[webhook] enqueue failed, event ${event.id} left PENDING: ${(e as Error).message}`);
  }
  return { eventId: event.id, duplicate: false };
}

/** Applies the WooCommerce resource and returns the resulting status + workflow trigger. */
async function applyEvent(topic: string, payload: unknown): Promise<EventOutcome> {
  switch (topic) {
    case 'customer.created':
    case 'customer.updated': {
      const { customer, created } = await upsertWooCustomer(payload as WooCustomer);
      return { status: 'PROCESSED', trigger: created ? { trigger: 'CUSTOMER_CREATED', customerId: customer.id } : null };
    }
    case 'order.created':
    case 'order.updated': {
      const r = await upsertWooOrder(payload as WooOrder, 'WEBHOOK');
      if (r.stale) return { status: 'IGNORED', trigger: null };
      if (r.created) return { status: 'PROCESSED', trigger: { trigger: 'ORDER_CREATED', customerId: r.customerId, orderId: r.orderId } };
      if (r.statusChanged) {
        return {
          status: 'PROCESSED',
          trigger: { trigger: 'ORDER_STATUS_CHANGED', customerId: r.customerId, orderId: r.orderId, previousStatus: r.previousStatus },
        };
      }
      return { status: 'PROCESSED', trigger: null };
    }
    default:
      // customer.deleted / order.deleted and unknown topics are recorded but not applied.
      return { status: 'IGNORED', trigger: null };
  }
}

/**
 * Worker: upsert resource → detect transitions → evaluate workflows.
 *
 * Retry-safe: the outcome (incl. trigger) is saved before workflows run, and each workflow run is
 * unique per (workflow, event), so a retry after a crash re-dispatches only the workflows that
 * have not run yet — never losing a trigger and never sending an email twice.
 */
export async function processWebhookEvent(eventId: string, attempt = 1): Promise<void> {
  const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.status === 'PROCESSED' || event.status === 'IGNORED') return; // already done (duplicate job)
  await prisma.webhookEvent.update({ where: { id: eventId }, data: { attempts: attempt } });

  let outcome = parseJson<EventOutcome | null>(event.outcome, null);
  if (!outcome) {
    outcome = await applyEvent(event.topic, JSON.parse(event.payload));
    await prisma.webhookEvent.update({ where: { id: eventId }, data: { outcome: JSON.stringify(outcome) } });
  }
  if (outcome.trigger) await runWorkflows(outcome.trigger, { webhookEventId: eventId });

  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { status: outcome.status, error: null, processedAt: new Date() },
  });
  await invalidate(); // dashboard / at-risk read models changed
}

/** Called when a job exhausts its retries. Stores a short, sanitized reason (full error stays in logs). */
export async function markEventFailed(eventId: string, error: unknown) {
  console.error(`[webhook] event ${eventId} failed permanently:`, error);
  await prisma.webhookEvent.update({ where: { id: eventId }, data: { status: 'FAILED', error: sanitizeError(error) } });
}

export function sanitizeError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === 'P2002') return 'Conflicting record: a unique field (e.g. email) is already used by another record';
  if (code === 'P2003') return 'Referenced record does not exist';
  if (code?.startsWith('P')) return `Database error ${code}`;
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0].replace(/[A-Z]:\\[^\s]+|\/[\w./-]+\.(ts|js)(:\d+)*/g, '[path]').slice(0, 200);
}

/** Re-queues PENDING events (crash/restart or Redis outage) and, on demand, FAILED ones. */
export async function requeueEvents(statuses: string[] = ['PENDING'], olderThanMs = 0): Promise<number> {
  const events = await prisma.webhookEvent.findMany({
    where: { status: { in: statuses }, receivedAt: { lte: new Date(Date.now() - olderThanMs) } },
    orderBy: { receivedAt: 'asc' },
  });
  const queue = getWebhookQueue();
  let queued = 0;
  for (const e of events) {
    try {
      if (e.status === 'FAILED') {
        await prisma.webhookEvent.update({ where: { id: e.id }, data: { status: 'PENDING' } });
        await queue.retry(e.id);
      } else {
        await queue.enqueue(e.id);
      }
      queued++;
    } catch (err) {
      // Queue unavailable: the event stays PENDING in the DB and the sweeper tries again later.
      console.warn(`[webhook] could not enqueue ${e.id}: ${(err as Error).message}`);
      break;
    }
  }
  return queued;
}

// In-process mode: the API consumes its own queue. With BullMQ, src/worker.ts consumes it.
bindInProcessConsumer(processWebhookEvent, markEventFailed);

/** Backwards-compatible handle used by tests and the sync-health endpoint. */
export const webhookQueue = {
  onIdle: () => getWebhookQueue().onIdle(),
};
