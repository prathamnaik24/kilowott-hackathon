/**
 * Standalone BullMQ worker process: `npm run worker -w server`.
 *
 * Consumes the Redis-backed webhook queue so heavy work (upserts, workflow actions, emails) runs
 * outside the API process — the API stays fast and the two can be scaled/restarted independently.
 */
import { env } from './config/env.js';
import { prisma } from './lib/db.js';
import { closeRedis, redisEnabled } from './lib/redis.js';
import { startBullMqWorker } from './queues/webhook-queue.js';
import { markEventFailed, processWebhookEvent } from './modules/webhooks/webhook.service.js';

if (!redisEnabled()) {
  console.log('[worker] REDIS_URL is not set — the API processes webhooks in-process. Nothing to do.');
  process.exit(0);
}

const worker = startBullMqWorker(processWebhookEvent, markEventFailed);
console.log(`[worker] consuming BullMQ queue on ${env.REDIS_URL.replace(/\/\/.*@/, '//***@')}`);

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, finishing current job...`);
  await worker.close(); // waits for the active job, takes no new ones
  await closeRedis();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
