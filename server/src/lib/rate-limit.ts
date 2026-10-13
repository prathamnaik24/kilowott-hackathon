import { getRedis, withTimeout } from './redis.js';

/**
 * Fixed-window rate limiter.
 *
 * Redis: `INCR` + `EXPIRE NX` in one MULTI — atomic, so concurrent requests on several API
 * instances share one counter, and the key expires on its own (no cleanup job).
 * Fallback: in-memory map (single instance only).
 */
const memory = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const redis = getRedis();
  if (redis) {
    try {
      const k = `woopulse:ratelimit:${key}`;
      const res = await withTimeout(redis.multi().incr(k).expire(k, windowSeconds, 'NX').ttl(k).exec());
      const countValue = Number(res?.[0]?.[1] ?? 0);
      const ttl = Math.max(1, Number(res?.[2]?.[1] ?? windowSeconds));
      return { allowed: countValue <= limit, remaining: Math.max(0, limit - countValue), retryAfterSeconds: ttl };
    } catch {
      // Fail open: an unavailable Redis must not lock every user out of the CRM.
      return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    }
  }
  const now = Date.now();
  const entry = memory.get(key);
  const current = !entry || entry.resetAt <= now ? { count: 0, resetAt: now + windowSeconds * 1000 } : entry;
  current.count++;
  memory.set(key, current);
  return {
    allowed: current.count <= limit,
    remaining: Math.max(0, limit - current.count),
    retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000),
  };
}

/** Current count in the window without incrementing (0 when unknown or Redis unavailable). */
export async function peekRateLimit(key: string): Promise<number> {
  const redis = getRedis();
  if (redis) {
    try {
      return Number((await withTimeout(redis.get(`woopulse:ratelimit:${key}`))) ?? 0);
    } catch {
      return 0;
    }
  }
  const entry = memory.get(key);
  return entry && entry.resetAt > Date.now() ? entry.count : 0;
}

export async function resetRateLimit(key: string) {
  const redis = getRedis();
  if (redis) await withTimeout(redis.del(`woopulse:ratelimit:${key}`)).catch(() => {});
  else memory.delete(key);
}

/** Test helper. */
export function resetMemoryRateLimits() {
  memory.clear();
}
