import { getRedis, withTimeout } from './redis.js';

/**
 * Cache-aside cache for expensive read models (dashboard, at-risk scan).
 *
 * - Redis when configured: shared by every API instance AND invalidated by the separate worker
 *   process when a webhook changes data — that cross-process invalidation is why it lives in Redis.
 * - In-memory Map otherwise (single process, tests).
 * - Redis failures never break a request: the value is simply recomputed (fail-open).
 * Hit/miss counters are kept in Redis too, so the Sync health page shows cluster-wide numbers.
 */
const PREFIX = 'woopulse:cache:';
const STATS = 'woopulse:cache:stats';

export const CacheKeys = {
  dashboard: 'dashboard:v1',
  atRisk: 'at-risk:all:v1',
} as const;

const memory = new Map<string, { value: string; expiresAt: number }>();
const memoryStats = { hits: 0, misses: 0 };

async function read(key: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) return withTimeout(redis.get(PREFIX + key));
  const entry = memory.get(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.value;
}

async function write(key: string, value: string, ttlSeconds: number) {
  const redis = getRedis();
  if (redis) await withTimeout(redis.set(PREFIX + key, value, 'EX', ttlSeconds));
  else memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function count(field: 'hits' | 'misses') {
  const redis = getRedis();
  if (redis) await withTimeout(redis.hincrby(STATS, field, 1)).catch(() => {});
  else memoryStats[field]++;
}

export async function getOrSet<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  try {
    const cached = await read(key);
    if (cached !== null) {
      await count('hits');
      return JSON.parse(cached) as T;
    }
  } catch {
    /* Redis unavailable: fall through and compute */
  }
  await count('misses');
  const value = await compute();
  try {
    await write(key, JSON.stringify(value), ttlSeconds);
  } catch {
    /* ignore cache write failures */
  }
  return value;
}

/** Drops cached read models after data changes (webhook processed, sync, new activity). */
export async function invalidate(...keys: string[]) {
  const targets = keys.length ? keys : Object.values(CacheKeys);
  const redis = getRedis();
  if (redis) await withTimeout(redis.del(...targets.map((k) => PREFIX + k))).catch(() => {});
  else targets.forEach((k) => memory.delete(k));
}

export async function cacheStats(): Promise<{ driver: 'redis' | 'memory'; hits: number; misses: number }> {
  const redis = getRedis();
  if (!redis) return { driver: 'memory', ...memoryStats };
  try {
    const s = await withTimeout(redis.hgetall(STATS));
    return { driver: 'redis', hits: Number(s.hits ?? 0), misses: Number(s.misses ?? 0) };
  } catch {
    return { driver: 'redis', hits: -1, misses: -1 };
  }
}

/** Test helper. */
export function resetMemoryCache() {
  memory.clear();
  memoryStats.hits = 0;
  memoryStats.misses = 0;
}
