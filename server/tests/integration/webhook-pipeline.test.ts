import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bootstrap } from '../../src/bootstrap.js';
import { signWebhookBody } from '../../src/integrations/woocommerce/woocommerce.signature.js';
import { prisma } from '../../src/lib/db.js';
import { processWebhookEvent, webhookQueue } from '../../src/modules/webhooks/webhook.service.js';
import { resetMemoryRateLimits } from '../../src/lib/rate-limit.js';
import { resetMemoryCache } from '../../src/lib/cache.js';
import { wooCustomer, wooOrder } from '../fixtures/woo.js';

const SECRET = 'test-webhook-secret';
const app = createApp();

function sendWebhook(topic: string, payload: unknown, opts: { deliveryId?: string; signature?: string } = {}) {
  const body = JSON.stringify(payload);
  return request(app)
    .post('/api/webhooks/woocommerce')
    .set('Content-Type', 'application/json')
    .set('X-WC-Webhook-Topic', topic)
    .set('X-WC-Webhook-Delivery-ID', opts.deliveryId ?? randomUUID())
    .set('X-WC-Webhook-Signature', opts.signature ?? signWebhookBody(body, SECRET))
    .send(body);
}

async function deliver(topic: string, payload: unknown) {
  const res = await sendWebhook(topic, payload);
  expect(res.status).toBe(202);
  await webhookQueue.onIdle();
}

async function resetData() {
  await prisma.$transaction([
    prisma.workflowRun.deleteMany(),
    prisma.activity.deleteMany(),
    prisma.orderStatusEvent.deleteMany(),
    prisma.order.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.webhookEvent.deleteMany(),
  ]);
}

beforeAll(async () => {
  await bootstrap();
});

beforeEach(async () => {
  await resetData();
  resetMemoryRateLimits();
  resetMemoryCache();
});

describe('POST /api/webhooks/woocommerce', () => {
  it('acknowledges the WooCommerce creation ping', async () => {
    const res = await request(app).post('/api/webhooks/woocommerce').type('form').send('webhook_id=12');
    expect(res.status).toBe(200);
    expect(res.body.ping).toBe(true);
  });

  it('rejects an invalid signature and stores nothing', async () => {
    const res = await sendWebhook('order.created', wooOrder(), { signature: 'forged' });
    expect(res.status).toBe(401);
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('creates a guest customer from an order with customer_id = 0', async () => {
    await deliver('order.created', wooOrder({ customer_id: 0 }));
    const customer = await prisma.customer.findUniqueOrThrow({ where: { email: 'priya.sharma@example.com' } });
    expect(customer.isGuest).toBe(true);
    expect(await prisma.order.count({ where: { customerId: customer.id } })).toBe(1);
  });

  it('is idempotent for duplicate deliveries and replayed payloads', async () => {
    await deliver('customer.created', wooCustomer());
    const order = wooOrder();
    const deliveryId = randomUUID();
    await sendWebhook('order.created', order, { deliveryId });
    const dup = await sendWebhook('order.created', order, { deliveryId });
    expect(dup.body.duplicate).toBe(true);
    await webhookQueue.onIdle();
    await deliver('order.updated', order); // same payload, new delivery id

    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.orderStatusEvent.count()).toBe(1);
    expect(await prisma.webhookEvent.count()).toBe(3);
  });

  it('records status transitions and runs matching workflows', async () => {
    await deliver('customer.created', wooCustomer());
    await deliver('order.created', wooOrder());
    await deliver('order.updated', wooOrder({ status: 'on-hold', date_modified_gmt: '2026-10-02T10:00:00' }));

    const events = await prisma.orderStatusEvent.findMany({ orderBy: { occurredAt: 'asc' } });
    expect(events.map((e) => [e.previousStatus, e.newStatus])).toEqual([
      [null, 'processing'],
      ['processing', 'on-hold'],
    ]);

    const runs = await prisma.workflowRun.findMany({ include: { workflow: true } });
    expect(runs.map((r) => r.workflow.key).sort()).toEqual(['on-hold-apology', 'vip-order', 'welcome-new-customer']);
    expect(runs.every((r) => r.status === 'SUCCESS')).toBe(true);

    const activities = await prisma.activity.findMany();
    expect(activities.some((a) => a.type === 'EMAIL' && a.title === 'An update on your order #9001')).toBe(true);
    expect(activities.some((a) => a.type === 'TASK' && a.title === 'Resolve on-hold order #9001')).toBe(true);
    const customer = await prisma.customer.findFirstOrThrow();
    expect(JSON.parse(customer.tags)).toContain('vip');
  });

  it('ignores out-of-order (stale) deliveries', async () => {
    await deliver('order.created', wooOrder({ status: 'completed', date_modified_gmt: '2026-10-05T10:00:00' }));
    await deliver('order.updated', wooOrder({ status: 'processing', date_modified_gmt: '2026-10-03T10:00:00' }));

    const order = await prisma.order.findFirstOrThrow();
    expect(order.status).toBe('completed');
    const last = await prisma.webhookEvent.findFirstOrThrow({ orderBy: { receivedAt: 'desc' } });
    expect(last.status).toBe('IGNORED');
  });
});

describe('workflow failure isolation and retry safety (AUD-002)', () => {
  it('runs other workflows when one is broken, records the failure, and never repeats side effects on retry', async () => {
    const cond = JSON.stringify([{ field: 'order.newStatus', op: 'eq', value: 'completed' }]);
    await prisma.workflow.create({ data: { key: 't-bogus', name: 'bogus', description: '', trigger: 'ORDER_STATUS_CHANGED', conditions: cond, actions: JSON.stringify([{ type: 'BOGUS' }]) } });
    await prisma.workflow.create({ data: { key: 't-after', name: 'after', description: '', trigger: 'ORDER_STATUS_CHANGED', conditions: cond, actions: JSON.stringify([{ type: 'CREATE_TASK', title: 'after-task', body: '', dueInHours: 1 }]) } });
    try {
      await deliver('order.created', wooOrder());
      await deliver('order.updated', wooOrder({ status: 'completed', date_modified_gmt: '2026-10-02T10:00:00' }));

      const runs = await prisma.workflowRun.findMany({ include: { workflow: true } });
      const byKey = (k: string) => runs.filter((r) => r.workflow.key === k);
      expect(byKey('t-after').map((r) => r.status)).toEqual(['SUCCESS']);
      expect(byKey('t-bogus').map((r) => r.status)).toEqual(['FAILED']);
      expect(byKey('completed-review-request').map((r) => r.status)).toEqual(['SUCCESS']);

      // Simulate a retry of the same event (e.g. worker crashed after running workflows).
      const ev = await prisma.webhookEvent.findFirstOrThrow({ where: { topic: 'order.updated' } });
      await prisma.webhookEvent.update({ where: { id: ev.id }, data: { status: 'PENDING' } });
      await processWebhookEvent(ev.id, 2);
      expect(await prisma.workflowRun.count()).toBe(runs.length);
      expect(await prisma.activity.count({ where: { title: 'after-task' } })).toBe(1);
    } finally {
      await prisma.workflow.deleteMany({ where: { key: { in: ['t-bogus', 't-after'] } } });
    }
  });

  it('re-dispatches a saved trigger when workflows crashed before running', async () => {
    await deliver('order.created', wooOrder());
    // Simulate: order update applied + outcome saved, but the worker died before workflows ran.
    const evOutcome = { status: 'PROCESSED', trigger: null as unknown };
    const order = await prisma.order.findFirstOrThrow();
    evOutcome.trigger = { trigger: 'ORDER_STATUS_CHANGED', customerId: order.customerId, orderId: order.id, previousStatus: 'processing' };
    await prisma.order.update({ where: { id: order.id }, data: { status: 'on-hold' } });
    const ev = await prisma.webhookEvent.create({ data: { topic: 'order.updated', payload: '{}', outcome: JSON.stringify(evOutcome) } });
    await processWebhookEvent(ev.id, 2);
    const runs = await prisma.workflowRun.findMany({ where: { webhookEventId: ev.id }, include: { workflow: true } });
    expect(runs.map((r) => r.workflow.key)).toEqual(['on-hold-apology']);
  });
});

describe('API auth', () => {
  it('requires a token for CRM endpoints', async () => {
    expect((await request(app).get('/api/customers')).status).toBe(401);
  });

  it('logs in and lists customers; agents cannot toggle workflows', async () => {
    await deliver('customer.created', wooCustomer());
    const login = await request(app).post('/api/auth/login').send({ email: 'agent@woopulse.dev', password: 'demo1234' });
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.token}` };

    const list = await request(app).get('/api/customers?search=priya').set(auth);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);

    const wf = await prisma.workflow.findFirstOrThrow();
    const toggle = await request(app).patch(`/api/workflows/${wf.id}`).set(auth).send({ isActive: false });
    expect(toggle.status).toBe(403);
  });

  it('locks out after repeated failures, even for the right password (rate limit)', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/auth/login').send({ email: 'admin@woopulse.dev', password: 'wrong' + i })).status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email: 'admin@woopulse.dev', password: 'wrong' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect((await request(app).post('/api/auth/login').send({ email: 'admin@woopulse.dev', password: 'demo1234' })).status).toBe(429);
  });

  it('rejects bad credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@woopulse.dev', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
