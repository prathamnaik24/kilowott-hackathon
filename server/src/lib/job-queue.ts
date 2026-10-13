/**
 * Minimal in-process job queue with retries and exponential backoff.
 *
 * Jobs run one at a time (preserving webhook order per store). Durability comes from the
 * caller persisting work first (e.g. the webhook_events table) and re-enqueuing PENDING rows
 * on boot. Swap for BullMQ + Redis when running multiple API instances.
 */
export interface JobQueueOptions {
  maxAttempts?: number;
  backoffMs?: number;
  onFailed?: (jobId: string, error: unknown) => void | Promise<void>;
}

interface QueuedJob<T> {
  id: string;
  data: T;
  attempt: number;
}

export class JobQueue<T> {
  private readonly jobs: QueuedJob<T>[] = [];
  private running = false;
  private idleWaiters: Array<() => void> = [];
  private readonly maxAttempts: number;
  private readonly backoffMs: number;

  constructor(
    private readonly handler: (data: T, attempt: number) => Promise<void>,
    private readonly options: JobQueueOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.backoffMs = options.backoffMs ?? 500;
  }

  enqueue(id: string, data: T): void {
    this.jobs.push({ id, data, attempt: 1 });
    void this.drain();
  }

  get size(): number {
    return this.jobs.length + (this.running ? 1 : 0);
  }

  /** Resolves once every queued job (including retries) has finished. Used by tests. */
  onIdle(): Promise<void> {
    if (!this.running && this.jobs.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.jobs.length > 0) {
      const job = this.jobs.shift()!;
      try {
        await this.handler(job.data, job.attempt);
      } catch (error) {
        if (job.attempt < this.maxAttempts) {
          await new Promise((r) => setTimeout(r, this.backoffMs * 2 ** (job.attempt - 1)));
          this.jobs.unshift({ ...job, attempt: job.attempt + 1 });
        } else {
          await this.options.onFailed?.(job.id, error);
        }
      }
    }
    this.running = false;
    this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }
}
