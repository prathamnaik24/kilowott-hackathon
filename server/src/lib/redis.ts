import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/**
 * Shared Redis connection, or null when REDIS_URL is not configured (tests / zero-infra demo).
 *
 * `maxRetriesPerRequest: null` is required by BullMQ workers (blocking commands must wait for
 * reconnection instead of failing). Callers that must fail fast (cache, rate limiter) use
 * `withTimeout` so a Redis outage degrades features instead of hanging requests.
 */
let client: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  if (!env.REDIS_URL) return (client = null);
  client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  client.on('error', (e) => console.warn(`[redis] ${e.message}`));
  return client;
}

export const redisEnabled = () => Boolean(env.REDIS_URL);

/** Rejects if a Redis call takes longer than `ms` (e.g. Redis down and commands are queued). */
export function withTimeout<T>(promise: Promise<T>, ms = 300): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`redis timeout after ${ms}ms`)), ms)),
  ]);
}

export async function closeRedis() {
  if (client) await client.quit().catch(() => client?.disconnect());
  client = undefined;
}
