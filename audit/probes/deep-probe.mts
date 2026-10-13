// Deep probes against the ISOLATED audit DB (DATABASE_URL must point at scratchpad/audit.db).
import { createHmac, randomUUID } from 'node:crypto';
import net from 'node:net';

const SRC = 'file:///D:/kilowott%20hackathon/server/src';
const { prisma } = await import(`${SRC}/lib/db.ts`);
const { JobQueue } = await import(`${SRC}/lib/job-queue.ts`);
const { WooCommerceClient } = await import(`${SRC}/integrations/woocommerce/woocommerce.client.ts`);
const { upsertCustomer } = await import(`${SRC}/modules/sync/ingest.service.ts`);

if (!process.env.DATABASE_URL?.includes('scratchpad')) throw new Error('Refusing: not the isolated audit DB');
const out: Array<{ id: string; title: string; status: string; evidence: string }> = [];
const rec = (id: string, title: string, ok: boolean, evidence: string) => out.push({ id, title, status: ok ? 'PASS' : 'FAIL', evidence });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://localhost:4100';

// 1. Second email-less guest order: was it ingested?
const ev = await prisma.webhookEvent.findFirst({ where: { resourceId: 990012 } });
const o = await prisma.order.findUnique({ where: { wooOrderId: 990012 } });
rec('T-CUSTOMER-06', 'Second guest order without email is ingested (not lost)', !!o, `order 990012 in CRM: ${!!o}; webhook event status ${ev?.status}, attempts ${ev?.attempts}, error: ${(ev?.error ?? '').replace(/\s+/g, ' ').slice(-90)}`);

// 2. Workflow failure after order commit → retry skips workflows
await prisma.workflow.create({ data: { key: 'audit-bogus', name: 'AUDIT bogus', description: 'audit', trigger: 'ORDER_STATUS_CHANGED', conditions: JSON.stringify([{ field: 'order.newStatus', op: 'eq', value: 'completed' }]), actions: JSON.stringify([{ type: 'BOGUS' }]) } });
await prisma.workflow.create({ data: { key: 'audit-after', name: 'AUDIT after', description: 'audit', trigger: 'ORDER_STATUS_CHANGED', conditions: JSON.stringify([{ field: 'order.newStatus', op: 'eq', value: 'completed' }]), actions: JSON.stringify([{ type: 'CREATE_TASK', title: 'AUDIT-AFTER task', body: '', dueInHours: 1 }]) } });
const victim = await prisma.order.findFirstOrThrow({ where: { status: 'processing', wooOrderId: { lt: 900000 } } });
const woo = await (await fetch(`${BASE}/mock-woo/wp-json/wc/v3/orders/${victim.wooOrderId}`, { headers: { Authorization: 'Basic ' + Buffer.from('ck_mock:cs_mock').toString('base64') } })).json();
const body = JSON.stringify({ ...woo, status: 'completed', date_modified_gmt: new Date().toISOString().slice(0, 19) });
const res = await fetch(`${BASE}/api/webhooks/woocommerce`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-WC-Webhook-Topic': 'order.updated', 'X-WC-Webhook-Delivery-ID': randomUUID(), 'X-WC-Webhook-Signature': createHmac('sha256', 'audit-webhook-secret').update(body).digest('base64') } });
const { eventId } = await res.json();
await sleep(4000);
const wfEv = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
const afterRuns = await prisma.workflowRun.count({ where: { orderId: victim.id, workflow: { key: 'audit-after' } } });
const bogusRuns = await prisma.workflowRun.count({ where: { orderId: victim.id, workflow: { key: 'audit-bogus' } } });
const reviewRuns = await prisma.workflowRun.count({ where: { orderId: victim.id, workflow: { key: 'completed-review-request' } } });
rec('T-WORKFLOW-03', 'A failing workflow does not prevent other matching workflows from running', afterRuns === 1, `audit-after runs ${afterRuns}, review-request runs ${reviewRuns}`);
rec('T-WORKFLOW-04', 'A broken workflow produces a FAILED WorkflowRun / visible failure', bogusRuns > 0 || wfEv.status === 'FAILED', `bogus runs ${bogusRuns}; event status ${wfEv.status} after ${wfEv.attempts} attempts`);
await prisma.workflow.updateMany({ where: { key: { in: ['audit-bogus', 'audit-after'] } }, data: { isActive: false } });

// 3. JobQueue: does it keep processing if onFailed itself throws (e.g. DB unavailable)?
const processed: string[] = [];
const q = new JobQueue<string>(async (d: string) => { if (d === 'bad') throw new Error('boom'); processed.push(d); }, { maxAttempts: 1, backoffMs: 1, onFailed: async () => { throw new Error('db down'); } });
const unhandled: unknown[] = [];
process.on('unhandledRejection', (e) => unhandled.push(e));
q.enqueue('1', 'bad');
await sleep(100);
q.enqueue('2', 'good');
await sleep(300);
rec('T-QUEUE-02', 'Queue keeps processing after a failure-handler error', processed.includes('good'), `processed after failing onFailed: [${processed}]; unhandled rejections: ${unhandled.length}; queue size ${q.size}`);

// 4. Woo client against a store that accepts connections but never answers
const hang = net.createServer(() => {}).listen(0);
const port = (hang.address() as net.AddressInfo).port;
const client = new WooCommerceClient({ storeUrl: `http://127.0.0.1:${port}`, consumerKey: 'k', consumerSecret: 's' });
const t0 = Date.now();
const outcome = await Promise.race([client.getCustomers(1, 1).then(() => 'resolved', (e: Error) => `rejected: ${e.message}`), sleep(8000).then(() => 'still pending after 8s')]);
rec('T-WOO-06', 'WooCommerce requests time out instead of hanging', outcome !== 'still pending after 8s', `${outcome} (${Date.now() - t0}ms)`);
hang.close();

// 5. Network errors (connection refused) are retried
let calls = 0;
const flaky = new WooCommerceClient({ storeUrl: 'http://127.0.0.1:1', consumerKey: 'k', consumerSecret: 's', fetchImpl: (async () => { calls++; throw new TypeError('fetch failed'); }) as typeof fetch });
await flaky.getCustomers().catch(() => {});
rec('T-WOO-07', 'Transient network errors are retried with backoff', calls > 1, `fetch attempts on network error: ${calls}`);

// 6. Concurrent first-time upserts of the same customer (sync vs webhook race)
const email = `race.${Date.now()}@example.com`;
const m = { wooCustomerId: null, email, firstName: 'Race', lastName: 'Cond', phone: null, city: null, country: null, isGuest: true, wooCreatedAt: new Date() };
const settled = await Promise.allSettled([upsertCustomer(m), upsertCustomer(m)]);
const rejected = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
rec('T-DB-02', 'Concurrent upserts of the same new customer both succeed', rejected.length === 0, `${rejected.length} of 2 rejected${rejected[0] ? ': ' + String(rejected[0].reason?.code ?? rejected[0].reason).slice(0, 40) : ''}`);

console.log(JSON.stringify(out, null, 1));
await prisma.$disconnect();
process.exit(0);
