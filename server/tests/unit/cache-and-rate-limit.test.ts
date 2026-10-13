import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheStats, getOrSet, invalidate, resetMemoryCache } from '../../src/lib/cache.js';
import { hitRateLimit, peekRateLimit, resetMemoryRateLimits, resetRateLimit } from '../../src/lib/rate-limit.js';

// No REDIS_URL in tests → exercises the in-memory drivers (same contract as the Redis ones).
describe('cache-aside', () => {
  beforeEach(resetMemoryCache);

  it('computes once, then serves hits until invalidated', async () => {
    const compute = vi.fn(async () => ({ total: 42 }));
    expect(await getOrSet('k', 30, compute)).toEqual({ total: 42 });
    expect(await getOrSet('k', 30, compute)).toEqual({ total: 42 });
    expect(compute).toHaveBeenCalledTimes(1);
    await invalidate('k');
    await getOrSet('k', 30, compute);
    expect(compute).toHaveBeenCalledTimes(2);
    expect(await cacheStats()).toEqual({ driver: 'memory', hits: 1, misses: 2 });
  });

  it('expires entries after the TTL', async () => {
    vi.useFakeTimers();
    const compute = vi.fn(async () => 1);
    await getOrSet('ttl', 1, compute);
    vi.advanceTimersByTime(1500);
    await getOrSet('ttl', 1, compute);
    expect(compute).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('rate limiter', () => {
  beforeEach(resetMemoryRateLimits);

  it('allows up to the limit within the window, then blocks', async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await hitRateLimit('ip:user', 3, 60)).allowed);
    expect(results).toEqual([true, true, true, false]);
    expect(await peekRateLimit('ip:user')).toBe(4);
    await resetRateLimit('ip:user');
    expect((await hitRateLimit('ip:user', 3, 60)).allowed).toBe(true);
  });
});
