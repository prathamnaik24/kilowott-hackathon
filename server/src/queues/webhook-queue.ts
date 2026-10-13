import { Queue, Worker, type Job } from 'bullmq';
import { JobQueue } from '../lib/job-queue.js';
import { getRedis, redisEnabled } from '../lib/redis.js';

/**
 * Webhook processing queue with two interchangeable drivers:
 *
 * - **BullMQ (Redis)** when REDIS_URL is set: jobs survive API restarts, a separate worker process
 *   consumes them (`npm run worker`), retries use exponential backoff, and the BullMQ jobId is the
 *   webhook event id, so enqueuing the same event twice is a no-op (deduplication in Redis).
 * - **In-process** otherwise: same contract, used by tests and the zero-infrastructure demo.
 *
 * In both cases the database (WebhookEvent) stays the source of truth: events are persisted
 * BEFORE they are queued, so even losing Redis data never loses a webhook.
 */
export const WEBHOOK_QUEUE = 'woopulse-webhooks';
export const JOB_ATTEMPTS = 3;
const BACKOFF_MS = 500;

export interface WebhookJob {
  eventId: string;
}

export type ProcessFn = (eventId: string, attempt: number) => Promise<void>;
export type FailFn = (eventId: string, error: unknown) => Promise<void>;

export interface WebhookQueueDriver {
  readonly driver: 'bullmq' | 'in-process';
  enqueue(eventId: string): Promise<void>;
  /** Re-run an event whose job permanently failed. */
  retry(eventId: string): Promise<void>;
  counts(): Promise<{ waiting: number; active: number; delayed: number; failed: number }>;
  /** In-process only: resolves when all work is done (tests). */
  onIdle(): Promise<void>;
}

// ---------------------------------------------------------------- BullMQ driver ----------
class BullMqWebhookQueue implements WebhookQueueDriver {
  readonly driver = 'bullmq' as const;
  private readonly queue: Queue<WebhookJob>;

  constructor() {
    this.queue = new Queue<WebhookJob>(WEBHOOK_QUEUE, {
      connection: getRedis()!,
      defaultJobOptions: {
        attempts: JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: BACKOFF_MS },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }

  async enqueue(eventId: string) {
    // jobId = eventId → BullMQ ignores duplicates while the job is still known to Redis.
    await this.queue.add('process-webhook', { eventId }, { jobId: eventId });
  }

  async retry(eventId: string) {
    const job = await this.queue.getJob(eventId);
    if (job && (await job.isFailed())) await job.retry();
    else if (!job) await this.enqueue(eventId);
  }

  async counts() {
    const c = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    return { waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0 };
  }

  onIdle(): Promise<void> {
    throw new Error('onIdle is only available for the in-process driver');
  }
}

/**
 * Starts a BullMQ worker. Concurrency 1 keeps events for the same store in arrival order
 * (status transitions depend on ordering); scale out by sharding queues per store.
 */
export function startBullMqWorker(process: ProcessFn, fail: FailFn): Worker<WebhookJob> {
  const worker = new Worker<WebhookJob>(
    WEBHOOK_QUEUE,
    async (job: Job<WebhookJob>) => process(job.data.eventId, job.attemptsMade + 1),
    { connection: getRedis()!, concurrency: 1 },
  );
  worker.on('failed', (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? JOB_ATTEMPTS)) {
      fail(job.data.eventId, error).catch((e) => console.error('[worker] could not mark event failed', e));
    }
  });
  worker.on('error', (e) => console.error('[worker]', e.message));
  return worker;
}

// ------------------------------------------------------------ In-process driver ----------
class InProcessWebhookQueue implements WebhookQueueDriver {
  readonly driver = 'in-process' as const;
  private queue: JobQueue<string> | null = null;
  private fail: FailFn | null = null;

  /** The API process both produces and consumes. */
  bind(process: ProcessFn, fail: FailFn) {
    this.fail = fail;
    this.queue = new JobQueue<string>((eventId, attempt) => process(eventId, attempt), {
      maxAttempts: JOB_ATTEMPTS,
      backoffMs: BACKOFF_MS,
      onFailed: (eventId, error) => fail(eventId, error),
    });
  }

  async enqueue(eventId: string) {
    if (!this.queue) throw new Error('In-process webhook queue has no consumer bound');
    this.queue.enqueue(eventId, eventId);
  }

  retry(eventId: string) {
    return this.enqueue(eventId);
  }

  async counts() {
    return { waiting: this.queue?.size ?? 0, active: 0, delayed: 0, failed: 0 };
  }

  onIdle() {
    return this.queue?.onIdle() ?? Promise.resolve();
  }
}

let instance: WebhookQueueDriver | null = null;

export function getWebhookQueue(): WebhookQueueDriver {
  instance ??= redisEnabled() ? new BullMqWebhookQueue() : new InProcessWebhookQueue();
  return instance;
}

/** Wires the in-process driver to the processor (no-op for BullMQ, which uses startBullMqWorker). */
export function bindInProcessConsumer(process: ProcessFn, fail: FailFn) {
  const q = getWebhookQueue();
  if (q instanceof InProcessWebhookQueue) q.bind(process, fail);
}
