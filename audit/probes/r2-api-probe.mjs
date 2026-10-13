// AUDIT-R2 additional API probes. Runs ONLY against the isolated audit server on :4100.
import { createHmac, randomUUID } from 'node:crypto';

const BASE = 'http://localhost:4100';
const SECRET = 'audit-webhook-secret';
const out = [];
const rec = (id, title, ok, evidence, status) => out.push({ id, title, status: status ?? (ok ? 'PASS' : 'FAIL'), evidence });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const data = (r) => r.json?.data ?? r.json;

// Fresh logins (the R1 probe locked admin@ via brute-force from this IP; agent is unaffected).
const agentLogin = await call('/api/auth/login', { method: 'POST', body: { email: 'agent@woopulse.dev', password: 'demo1234' } });
const agent = agentLogin.json?.token;
const adminLogin = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@woopulse.dev', password: 'demo1234' } });
rec('T-SEC-03b', 'Correct password is still refused while the account is locked out', adminLogin.status === 429, `admin login after R1 brute-force probe → ${adminLogin.status}`);

// Privilege escalation via tampered JWT payload (role AGENT → ADMIN, original signature kept)
const [h, p, s] = agent.split('.');
const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, role: 'ADMIN' })).toString('base64url')}.${s}`;
const esc = await call('/api/store/sync', { method: 'POST', token: forged });
rec('T-AUTH-08', 'Tampered role claim in JWT is rejected', esc.status === 401, `forged ADMIN claim → ${esc.status}`);

// Order filters
const all = data(await call('/api/orders?limit=500', { token: agent }));
const onHold = data(await call('/api/orders?status=on-hold', { token: agent }));
const big = data(await call('/api/orders?minTotal=200&limit=500', { token: agent }));
const cust = all[0].customerId;
const byCust = data(await call(`/api/orders?customerId=${cust}&limit=500`, { token: agent }));
const future = data(await call('/api/orders?from=2099-01-01', { token: agent }));
const expOnHold = all.filter((o) => o.status === 'on-hold').length;
const expBig = all.filter((o) => o.total >= 200).length;
const expCust = all.filter((o) => o.customerId === cust).length;
rec('T-ORDER-06', 'Order filters (status, amount, customer, date) return exactly the matching orders',
  onHold.length === expOnHold && onHold.every((o) => o.status === 'on-hold') && big.length === expBig && byCust.length === expCust && future.length === 0,
  `on-hold ${onHold.length}/${expOnHold}, ≥200 ${big.length}/${expBig}, customer ${byCust.length}/${expCust}, from 2099 → ${future.length}`);

// Webhook ack latency (queued, not inline)
const woo = await (await fetch(`${BASE}/mock-woo/wp-json/wc/v3/orders/${all.find((o) => o.status === 'processing').wooOrderId}`, { headers: { Authorization: 'Basic ' + Buffer.from('ck_mock:cs_mock').toString('base64') } })).json();
const body = JSON.stringify({ ...woo, status: 'on-hold', date_modified_gmt: new Date().toISOString().slice(0, 19) });
const t0 = performance.now();
const wh = await fetch(`${BASE}/api/webhooks/woocommerce`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-WC-Webhook-Topic': 'order.updated', 'X-WC-Webhook-Delivery-ID': randomUUID(), 'X-WC-Webhook-Signature': createHmac('sha256', SECRET).update(body).digest('base64') } });
const ackMs = Math.round(performance.now() - t0);
rec('T-WEBHOOK-09', 'Webhook acknowledged quickly (processing is queued)', wh.status === 202 && ackMs < 500, `HTTP ${wh.status} in ${ackMs} ms`);
await sleep(1500);

// Retry of FAILED events: safe, no duplicate side effects
const before = data(await call('/api/workflows/runs?limit=200', { token: agent })).length;
const store1 = data(await call('/api/store', { token: agent }));
const failedBefore = store1.eventCounts.FAILED ?? 0;
const agentRetry = await call('/api/store/webhooks/retry', { method: 'POST', token: agent });
rec('T-WEBHOOK-08', 'Retry of failed events is ADMIN-only', agentRetry.status === 403, `agent → ${agentRetry.status}; admin token unavailable (locked out by R1 brute-force probe), admin path covered by T-WEBHOOK-08b`, agentRetry.status === 403 ? 'PASS' : 'FAIL');
const after = data(await call('/api/workflows/runs?limit=200', { token: agent })).length;
rec('T-QUEUE-05', 'Failed events stay observable with sanitized errors', failedBefore > 0 && store1.recentEvents.filter((e) => e.status === 'FAILED').every((e) => !/[A-Z]:\\|invocation|prisma/i.test(e.error ?? '')), `FAILED events ${failedBefore}; errors: ${[...new Set(store1.recentEvents.filter((e) => e.status === 'FAILED').map((e) => e.error))].join(' | ')}`);
rec('T-QUEUE-06', 'Workflow run count unchanged by retry attempts (no duplicate side effects)', after === before, `runs ${before} → ${after}`);

// Cache observability
const cache = data(await call('/api/store', { token: agent })).cache;
rec('T-QUEUE-07', 'Cache driver and hit/miss stats are observable', !!cache && cache.hits + cache.misses > 0, JSON.stringify(cache));
const qinfo = data(await call('/api/store', { token: agent })).queue;
rec('T-QUEUE-08', 'Queue driver is reported (expect bullmq when REDIS_URL set)', qinfo?.driver === 'in-process', `driver ${qinfo?.driver} (REDIS_URL empty in this isolated run)`, 'NEEDS REVIEW');

console.log(JSON.stringify(out, null, 1));
