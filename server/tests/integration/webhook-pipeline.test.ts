import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { bootstrap } from '../../src/bootstrap.js';
import { signWebhookBody } from '../../src/integrations/woocommerce/woocommerce.signature.js';
import { prisma } from '../../src/lib/db.js';
import { webhookQueue } from '../../src/modules/webhooks/webhook.service.js';
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

beforeEach(resetData);

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

  it('rejects bad credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@woopulse.dev', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
