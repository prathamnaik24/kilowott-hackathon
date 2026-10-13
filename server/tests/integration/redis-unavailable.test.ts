import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression for AUD-022: with REDIS_URL configured but Redis unreachable, accepting a webhook must
 * not hang. The event is persisted as PENDING (for the sweeper) and acknowledged promptly.
 * Runs in a child process because the Redis driver is chosen when the config module loads.
 */
describe('webhook intake with Redis unreachable (AUD-022)', { timeout: 60_000 }, () => {
  it('acknowledges within ~1s and leaves the event PENDING', () => {
    const script = `
      const { acceptWebhook } = await import('./src/modules/webhooks/webhook.service.ts');
      const { prisma } = await import('./src/lib/db.ts');
      const t0 = Date.now();
      const { eventId } = await acceptWebhook({ deliveryId: 'redis-down-' + Date.now(), topic: 'order.created', payload: { id: 424242 } });
      const ms = Date.now() - t0;
      const ev = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
      await prisma.webhookEvent.delete({ where: { id: eventId } });
      console.log(JSON.stringify({ ms, status: ev.status }));
      process.exit(0);
    `;
    const out = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, REDIS_URL: 'redis://127.0.0.1:1', DATABASE_URL: 'file:./test.db', NODE_ENV: 'test' },
      encoding: 'utf8',
    });
    const result = JSON.parse(out.trim().split('\n').pop()!);
    expect(result.status).toBe('PENDING');
    expect(result.ms).toBeLessThan(2500);
  });
});
