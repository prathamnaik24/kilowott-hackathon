import { describe, expect, it, vi } from 'vitest';
import { JobQueue } from '../../src/lib/job-queue.js';

describe('JobQueue', () => {
  it('processes jobs in FIFO order', async () => {
    const seen: number[] = [];
    const q = new JobQueue<number>(async (n) => void seen.push(n));
    [1, 2, 3].forEach((n) => q.enqueue(String(n), n));
    await q.onIdle();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('retries failures and reports permanently failed jobs', async () => {
    const onFailed = vi.fn();
    let calls = 0;
    const q = new JobQueue<string>(
      async () => {
        calls++;
        throw new Error('boom');
      },
      { maxAttempts: 3, backoffMs: 1, onFailed },
    );
    q.enqueue('job-1', 'x');
    await q.onIdle();
    expect(calls).toBe(3);
    expect(onFailed).toHaveBeenCalledWith('job-1', expect.any(Error));
  });

  it('succeeds after a transient failure', async () => {
    let calls = 0;
    const q = new JobQueue<string>(async () => {
      if (++calls === 1) throw new Error('transient');
    }, { backoffMs: 1 });
    q.enqueue('a', 'a');
    await q.onIdle();
    expect(calls).toBe(2);
  });
});
