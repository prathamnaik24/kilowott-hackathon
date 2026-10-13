// WooPulse audit probes (AUD run R1). Runs against the ISOLATED audit server on :4100 only.
import { createHmac, randomUUID } from 'node:crypto';

const BASE = 'http://localhost:4100';
const SECRET = 'audit-webhook-secret';
const results = [];
const rec = (id, title, ok, evidence, status) =>
  results.push({ id, title, status: status ?? (ok ? 'PASS' : 'FAIL'), evidence });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = 'GET', token, body, raw, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text, headers: res.headers };
}
const data = (r) => r.json?.data ?? r.json;

function webhook(topic, payload, { deliveryId = randomUUID(), signature } = {}) {
  const body = JSON.stringify(payload);
  return call('/api/webhooks/woocommerce', {
    method: 'POST',
    raw: body,
    headers: {
      'Content-Type': 'application/json',
      'X-WC-Webhook-Topic': topic,
      'X-WC-Webhook-Delivery-ID': deliveryId,
      'X-WC-Webhook-Signature': signature ?? createHmac('sha256', SECRET).update(body).digest('base64'),
    },
  });
}
const wooAuth = { Authorization: 'Basic ' + Buffer.from('ck_mock:cs_mock').toString('base64') };
const nowWoo = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString().slice(0, 19);

// ---------- AUTH ----------
const health = await call('/api/health');
rec('T-ARCH-01', 'Health endpoint responds', health.status === 200, `GET /api/health → ${health.status}`);

const adminLogin = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@woopulse.dev', password: 'demo1234' } });
const admin = adminLogin.json?.token;
rec('T-AUTH-01', 'Admin login succeeds', adminLogin.status === 200 && !!admin, `POST /api/auth/login → ${adminLogin.status}`);
rec('T-SEC-01', 'Login response does not expose password hash', !/passwordHash|\$2[aby]\$/.test(adminLogin.text), `keys: ${Object.keys(adminLogin.json?.user ?? {}).join(',')}`);
const agentLogin = await call('/api/auth/login', { method: 'POST', body: { email: 'agent@woopulse.dev', password: 'demo1234' } });
const agent = agentLogin.json?.token;
rec('T-AUTH-02', 'Agent login succeeds', agentLogin.status === 200 && !!agent, `→ ${agentLogin.status}`);

const badPw = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@woopulse.dev', password: 'nope' } });
rec('T-AUTH-03', 'Wrong password rejected with 401', badPw.status === 401, `→ ${badPw.status} ${badPw.text}`);
const badEmail = await call('/api/auth/login', { method: 'POST', body: { email: 'not-an-email', password: 'x' } });
rec('T-SEC-02', 'Login input validated (400 on invalid email)', badEmail.status === 400, `→ ${badEmail.status}`);
const noTok = await call('/api/customers');
const badTok = await call('/api/customers', { token: 'garbage.token.value' });
rec('T-AUTH-04', 'CRM endpoints require a valid token', noTok.status === 401 && badTok.status === 401, `no token → ${noTok.status}, bad token → ${badTok.status}`);

const agentSync = await call('/api/store/sync', { method: 'POST', token: agent });
const agentRetry = await call('/api/store/webhooks/retry', { method: 'POST', token: agent });
const wfList = data(await call('/api/workflows', { token: agent }));
const agentToggle = await call(`/api/workflows/${wfList[0].id}`, { method: 'PATCH', token: agent, body: { isActive: false } });
rec('T-AUTH-05', 'AGENT cannot resync, retry events or toggle workflows (403)', [agentSync, agentRetry, agentToggle].every((r) => r.status === 403), `sync ${agentSync.status}, retry ${agentRetry.status}, toggle ${agentToggle.status}`);

// brute force / CORS
let lastBf;
for (let i = 0; i < 15; i++) lastBf = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@woopulse.dev', password: 'x' + i } });
rec('T-SEC-03', 'Login is rate-limited after repeated failures', lastBf.status === 429, `15 consecutive bad logins → last status ${lastBf.status}`);
const cors = await fetch(BASE + '/api/health', { headers: { Origin: 'https://evil.example' } });
rec('T-SEC-04', 'CORS restricted to known origins', cors.headers.get('access-control-allow-origin') !== '*', `Access-Control-Allow-Origin: ${cors.headers.get('access-control-allow-origin')}`);

// ---------- WOO SYNC ----------
const mockCust = await fetch(BASE + '/mock-woo/wp-json/wc/v3/customers?per_page=1', { headers: wooAuth });
const mockOrd = await fetch(BASE + '/mock-woo/wp-json/wc/v3/orders?per_page=1', { headers: wooAuth });
const wooCustomers = Number(mockCust.headers.get('x-wp-total'));
const wooOrders = Number(mockOrd.headers.get('x-wp-total'));
const dash1 = data(await call('/api/dashboard', { token: admin }));
const custList = data(await call('/api/customers', { token: admin }));
const guests = custList.filter((c) => c.isGuest).length;
rec('T-WOO-01', 'Initial sync imports all store orders', dash1.kpis.orders === wooOrders, `store orders ${wooOrders}, CRM orders ${dash1.kpis.orders}`);
rec('T-WOO-02', 'Initial sync imports all registered customers + guest customers', custList.length - guests === wooCustomers && guests > 0, `store customers ${wooCustomers}, CRM registered ${custList.length - guests}, guests ${guests}`);
const store1 = data(await call('/api/store', { token: admin }));
rec('T-WOO-03', 'Sync status/timestamp reflect successful sync', store1.store.syncStatus === 'SUCCESS' && !!store1.store.lastSyncedAt, `status ${store1.store.syncStatus}, lastSyncedAt ${store1.store.lastSyncedAt}`);

const resync = await call('/api/store/sync', { method: 'POST', token: admin });
const dash2 = data(await call('/api/dashboard', { token: admin }));
const custList2 = data(await call('/api/customers', { token: admin }));
rec('T-WOO-04', 'Repeated full sync creates no duplicates', resync.status === 200 && dash2.kpis.orders === dash1.kpis.orders && custList2.length === custList.length, `resync ${resync.status}; orders ${dash1.kpis.orders}→${dash2.kpis.orders}; customers ${custList.length}→${custList2.length}`);

rec('T-SEC-05', 'Store/sync-health API never returns Woo credentials or webhook secret', !/ck_mock|cs_mock|audit-webhook-secret|consumer/i.test(JSON.stringify(store1)), 'scanned GET /api/store body for key/secret values');

// ---------- WEBHOOKS ----------
const ping = await call('/api/webhooks/woocommerce', { method: 'POST', raw: 'webhook_id=42', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
rec('T-WEBHOOK-01', 'WooCommerce form-encoded creation ping acknowledged', ping.status === 200, `→ ${ping.status} ${ping.text}`);

const orders = data(await call('/api/orders?status=processing', { token: admin }));
const target = orders[0];
const wooTarget = await (await fetch(`${BASE}/mock-woo/wp-json/wc/v3/orders/${target.wooOrderId}`, { headers: wooAuth })).json();
const forged = await webhook('order.updated', { ...wooTarget, status: 'refunded', date_modified_gmt: nowWoo() }, { signature: 'Zm9yZ2Vk' });
await sleep(800);
const afterForged = data(await call(`/api/orders/${target.id}`, { token: admin }));
rec('T-WEBHOOK-02', 'Forged signature rejected; order unchanged', forged.status === 401 && afterForged.status === 'processing', `→ ${forged.status}; status still ${afterForged.status}`);

const runsBefore = data(await call('/api/workflows/runs?limit=200', { token: admin })).length;
const onHold = { ...wooTarget, status: 'on-hold', date_modified_gmt: nowWoo() };
const dId = randomUUID();
const ok = await webhook('order.updated', onHold, { deliveryId: dId });
await sleep(1500);
const o1 = data(await call(`/api/orders/${target.id}`, { token: admin }));
const lastEv = o1.statusEvents.at(-1);
rec('T-WEBHOOK-03', 'Valid webhook accepted asynchronously (202) and order updated', ok.status === 202 && o1.status === 'on-hold', `→ ${ok.status}; order status ${o1.status}`);
rec('T-ORDER-01', 'Status transition recorded with previous/new status and source', lastEv?.previousStatus === 'processing' && lastEv?.newStatus === 'on-hold' && lastEv?.source === 'WEBHOOK', JSON.stringify(lastEv && { p: lastEv.previousStatus, n: lastEv.newStatus, s: lastEv.source }));
const runs1 = data(await call('/api/workflows/runs?limit=200', { token: admin }));
const onHoldRun = runs1.find((r) => r.workflow.key === 'on-hold-apology' && r.order?.id === target.id);
rec('T-WORKFLOW-01', 'on-hold-apology workflow runs once with email + task actions', !!onHoldRun && onHoldRun.status === 'SUCCESS' && onHoldRun.output.map((x) => x.type).join() === 'SEND_EMAIL,CREATE_TASK', `runs +${runs1.length - runsBefore}; output ${JSON.stringify(onHoldRun?.output?.map((x) => x.type))}`);
const tl1 = data(await call(`/api/customers/${target.customerId}/timeline`, { token: admin }));
const emails1 = tl1.filter((t) => t.kind === 'EMAIL' && t.origin === 'workflow:on-hold-apology').length;
const tasks1 = tl1.filter((t) => t.kind === 'TASK' && t.origin === 'workflow:on-hold-apology').length;
rec('T-WORKFLOW-02', 'Workflow actions persisted as timeline activities', emails1 === 1 && tasks1 === 1, `emails ${emails1}, tasks ${tasks1}`);

const dup = await webhook('order.updated', onHold, { deliveryId: dId });
const replay = await webhook('order.updated', onHold);
await sleep(1200);
const o2 = data(await call(`/api/orders/${target.id}`, { token: admin }));
const runs2 = data(await call('/api/workflows/runs?limit=200', { token: admin }));
const tl2 = data(await call(`/api/customers/${target.customerId}/timeline`, { token: admin }));
rec('T-WEBHOOK-04', 'Duplicate delivery ID acknowledged without reprocessing', dup.json?.duplicate === true, `→ ${dup.status} ${dup.text}`);
rec('T-QUEUE-01', 'Replayed payload creates no extra status events, runs, emails or tasks',
  o2.statusEvents.length === o1.statusEvents.length && runs2.length === runs1.length && tl2.filter((t) => t.kind === 'EMAIL').length === tl1.filter((t) => t.kind === 'EMAIL').length,
  `statusEvents ${o1.statusEvents.length}→${o2.statusEvents.length}, runs ${runs1.length}→${runs2.length}, replay → ${replay.status}`);

const stale = await webhook('order.updated', { ...wooTarget, status: 'completed', date_modified_gmt: nowWoo(-3_600_000 * 24 * 30) });
await sleep(1000);
const o3 = data(await call(`/api/orders/${target.id}`, { token: admin }));
const ev3 = data(await call('/api/store', { token: admin })).recentEvents.find((e) => e.id === stale.json?.eventId);
rec('T-WEBHOOK-05', 'Older (stale) event does not overwrite newer state; marked IGNORED', o3.status === 'on-hold' && ev3?.status === 'IGNORED', `status ${o3.status}, event ${ev3?.status}`);

// guest handling
const gEmail = `Audit.Guest.${Date.now()}@Example.com`;
const gOrder = { ...wooTarget, id: 990001, number: '990001', customer_id: 0, status: 'processing', date_created_gmt: nowWoo(), date_modified_gmt: nowWoo(), billing: { ...wooTarget.billing, first_name: 'Gia', last_name: 'Guest', email: gEmail } };
await webhook('order.created', gOrder);
await webhook('order.created', { ...gOrder, id: 990002, number: '990002', billing: { ...gOrder.billing, email: gEmail.toUpperCase() } });
await sleep(1500);
const gMatches = data(await call(`/api/customers?search=${encodeURIComponent(gEmail.toLowerCase())}`, { token: admin }));
rec('T-CUSTOMER-01', 'Guest orders matched on normalized billing email (one customer, two orders)', gMatches.length === 1 && gMatches[0].ordersCount === 2 && gMatches[0].isGuest, `matches ${gMatches.length}, orders ${gMatches[0]?.ordersCount}`);

// guest orders WITHOUT any billing email
const noEmail1 = { ...gOrder, id: 990011, number: '990011', billing: { ...gOrder.billing, first_name: 'Nora', last_name: 'NoEmail', email: '' } };
const noEmail2 = { ...gOrder, id: 990012, number: '990012', billing: { ...gOrder.billing, first_name: 'Omar', last_name: 'Different', email: '' } };
await webhook('order.created', noEmail1);
await webhook('order.created', noEmail2);
await sleep(1500);
const allC = data(await call('/api/customers', { token: admin }));
const blank = allC.filter((c) => c.email === '');
rec('T-CUSTOMER-02', 'Distinct guest orders without email are NOT merged into one customer', !(blank.length === 1 && blank[0].ordersCount >= 2), `customers with empty email: ${blank.length}; their orders: ${blank.map((c) => `${c.firstName} ${c.lastName}:${c.ordersCount}`).join('; ')}`);

// email change colliding with existing guest record
const regId = 990100;
const regEmail = `reg.${Date.now()}@example.com`;
await webhook('customer.created', { id: regId, date_created_gmt: nowWoo(), email: regEmail, first_name: 'Rita', last_name: 'Reg', billing: { first_name: 'Rita', last_name: 'Reg', email: regEmail } });
await sleep(800);
const collide = await webhook('customer.updated', { id: regId, date_created_gmt: nowWoo(), email: gEmail.toLowerCase(), first_name: 'Rita', last_name: 'Reg', billing: { first_name: 'Rita', last_name: 'Reg', email: gEmail.toLowerCase() } });
await sleep(4500);
const collideEv = data(await call('/api/store', { token: admin })).recentEvents.find((e) => e.id === collide.json?.eventId);
rec('T-CUSTOMER-03', 'Registered customer taking a guest email is merged, not failed', collideEv?.status === 'PROCESSED', `event status ${collideEv?.status}, attempts ${collideEv?.attempts}, error: ${(collideEv?.error ?? '').replace(/\s+/g, ' ').slice(0, 160)}`);
rec('T-SEC-06', 'Failed-event errors are sanitized (no stack/SQL internals)', !collideEv?.error || !/prisma|invocation|\n\s+at /i.test(collideEv.error), `error excerpt: ${(collideEv?.error ?? '(none)').replace(/\s+/g, ' ').slice(0, 120)}`);

// ---------- ACTIVITIES / EMAIL SAFETY ----------
const malformed = await call('/api/activities', { method: 'POST', token: admin, raw: '{bad json', headers: { 'Content-Type': 'application/json' } });
rec('T-SEC-07', 'Malformed JSON body → 400 (not 500)', malformed.status === 400, `→ ${malformed.status} ${malformed.text}`);
const ghost = await call('/api/activities', { method: 'POST', token: admin, body: { customerId: 'does-not-exist', type: 'NOTE', title: 'x' } });
rec('T-SEC-08', 'Activity for unknown customer → 4xx (not 500)', ghost.status >= 400 && ghost.status < 500, `→ ${ghost.status} ${ghost.text}`);
const other = custList.find((c) => c.id !== target.customerId);
const mismatch = await call('/api/activities', { method: 'POST', token: admin, body: { customerId: other.id, orderId: target.id, type: 'NOTE', title: 'cross-link' } });
rec('T-DB-01', 'Activity cannot link an order belonging to a different customer', mismatch.status >= 400, `→ ${mismatch.status}`);
const note = await call('/api/activities', { method: 'POST', token: agent, body: { customerId: target.customerId, type: 'NOTE', title: 'Audit note', body: 'persist me' } });
const tlNote = data(await call(`/api/customers/${target.customerId}/timeline`, { token: agent })).some((t) => t.title === 'Audit note');
rec('T-CUSTOMER-04', 'Agent-created note persists on timeline', note.status === 201 && tlNote, `→ ${note.status}, on timeline ${tlNote}`);

const draft = data(await call('/api/activities', { method: 'POST', token: agent, body: { customerId: target.customerId, type: 'EMAIL', title: 'Draft subj', body: 'Draft body' } }));
const sentEdited = await call(`/api/activities/${draft.id}/send`, { method: 'POST', token: agent, body: { subject: 'Edited subj', body: 'Edited body' } });
rec('T-EMAIL-01', 'Email created without send=true stays DRAFT; approval sends edited content', draft.status === 'DRAFT' && data(sentEdited).status === 'SENT' && data(sentEdited).title === 'Edited subj', `draft ${draft.status} → ${data(sentEdited)?.status} "${data(sentEdited)?.title}"`);
const resend = await call(`/api/activities/${draft.id}/send`, { method: 'POST', token: agent, body: {} });
rec('T-EMAIL-02', 'Already-sent email cannot be sent again', resend.status === 400, `→ ${resend.status}`);

// ---------- AI ----------
const custForAi = custList.find((c) => c.firstName === 'Priya') ?? custList[0];
const sum = await call(`/api/ai/customers/${custForAi.id}/summary`, { method: 'POST', token: agent });
const custOrders = data(await call(`/api/orders?customerId=${custForAi.id}`, { token: admin })).map((o) => `#${o.number}`);
const sources = data(sum)?.sources ?? [];
rec('T-AI-01', 'Summary (rules mode) cites only the customer’s real orders', sum.status === 200 && sources.length > 0 && sources.every((s) => custOrders.includes(s)), `generatedBy ${data(sum)?.generatedBy}; sources ${sources.join(',')}`);
const aiDraft = data(await call(`/api/ai/customers/${custForAi.id}/draft`, { method: 'POST', token: agent, body: { goal: 'Check in', tone: 'friendly' } }));
const tlDraft = data(await call(`/api/customers/${custForAi.id}/timeline`, { token: agent })).find((t) => t.activityId === aiDraft.draftId);
rec('T-AI-02', 'AI draft is stored as DRAFT (never auto-sent)', tlDraft?.status === 'DRAFT' && tlDraft?.origin === 'ai', `timeline status ${tlDraft?.status}, origin ${tlDraft?.origin}`);
const cop = data(await call('/api/ai/copilot', { method: 'POST', token: agent, body: { message: 'hello' } }));
rec('T-AI-03', 'Copilot without LLM key degrades gracefully (no tool calls)', cop.steps?.length === 0 && /LLM_API_KEY/.test(cop.answer), cop.answer?.slice(0, 80));
const aiStatus = data(await call('/api/ai/status', { token: agent }));
rec('T-AI-04', 'Agent toolset has no send-email or SQL tool', !aiStatus.tools.some((t) => /send|sql|query|delete/i.test(t)), aiStatus.tools.join(','));

// ---------- FINANCIAL INTEGRITY ----------
const dash3 = data(await call('/api/dashboard', { token: admin }));
const cust3 = data(await call('/api/customers', { token: admin }));
const allOrders = data(await call('/api/orders?limit=500', { token: admin }));
const ltvSum = Math.round(cust3.reduce((s, c) => s + c.totalSpent, 0) * 100) / 100;
rec('T-ORDER-02', 'Dashboard revenue equals sum of customer LTVs', Math.abs(ltvSum - dash3.kpis.revenue) < 0.01, `dashboard ${dash3.kpis.revenue}, Σ LTV ${ltvSum}`);
rec('T-ORDER-03', 'Dashboard order KPI equals order count', dash3.kpis.orders === allOrders.length, `kpi ${dash3.kpis.orders}, list ${allOrders.length}`);
const eligible = new Set(['processing', 'on-hold', 'completed']);
const ltvErrors = cust3.filter((c) => {
  const exp = allOrders.filter((o) => o.customerId === c.id && eligible.has(o.status)).reduce((s, o) => s + o.total, 0);
  return Math.abs(exp - c.totalSpent) > 0.01;
});
rec('T-CUSTOMER-05', 'Per-customer LTV excludes cancelled/refunded/failed (and pending)', ltvErrors.length === 0, `customers with mismatched LTV: ${ltvErrors.length}`);

// ---------- RISK ----------
const risks = data(await call('/api/orders/at-risk', { token: admin }));
const priyaHold = risks.find((r) => r.customer.name.startsWith('Priya') && r.status === 'on-hold');
const stale24 = priyaHold?.flags.find((f) => f.code === 'STALE_ON_HOLD');
const pOrder = priyaHold && data(await call(`/api/orders/${priyaHold.orderId}`, { token: admin }));
const hoursSinceModified = pOrder ? Math.floor((Date.now() - new Date(pOrder.wooModifiedAt)) / 3.6e6) : null;
const reported = stale24 ? Number(stale24.reason.match(/(\d+)/)?.[1]) : null;
rec('T-ORDER-04', 'Time-in-status for imported orders measured from last modification', reported != null && Math.abs(reported - hoursSinceModified) <= 1, `flag says ${reported}h on hold; wooModifiedAt was ${hoursSinceModified}h ago`);

// ---------- VALIDATION / ERRORS ----------
const v1 = await call('/api/orders?limit=100000', { token: admin });
const v2 = await call('/api/customers?sort=__proto__', { token: admin });
rec('T-SEC-09', 'Query params validated (400)', v1.status === 400 && v2.status === 400, `limit → ${v1.status}, sort → ${v2.status}`);
const nf = await call('/api/customers/nope', { token: admin });
const nfo = await call('/api/orders/nope', { token: admin });
rec('T-SEC-10', 'Unknown IDs → 404 without stack traces', nf.status === 404 && nfo.status === 404 && !/\n\s+at /.test(nf.text + nfo.text), `customer ${nf.status}, order ${nfo.status}`);

// ---------- MOCK STORE EXPOSURE ----------
const badKeys = await fetch(BASE + '/mock-woo/wp-json/wc/v3/orders', { headers: { Authorization: 'Basic ' + Buffer.from('x:y').toString('base64') } });
rec('T-WOO-05', 'Mock store REST rejects wrong consumer keys', badKeys.status === 401, `→ ${badKeys.status}`);
const panel = await fetch(`${BASE}/mock-woo/panel/orders/${target.wooOrderId}/status`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'status=cancelled' });
await sleep(1500);
const o4 = data(await call(`/api/orders/${target.id}`, { token: admin }));
rec('T-SEC-11', 'Unauthenticated users cannot mutate store data via mock admin panel', !(panel.status === 303 && o4.status === 'cancelled'), `anonymous POST → ${panel.status}; CRM order now ${o4.status}`);

// ---------- UI ROUTES (served SPA) ----------
const routes = ['/', '/login', '/customers', `/customers/${target.customerId}`, '/orders', `/orders/${target.id}`, '/workflows', '/copilot', '/settings'];
const routeRes = await Promise.all(routes.map(async (r) => [r, (await fetch(BASE + r)).status]));
rec('T-UI-01', 'All client routes served by the API host (SPA fallback)', routeRes.every(([, s]) => s === 200), routeRes.map(([r, s]) => `${r}:${s}`).join(' '));

console.log(JSON.stringify(results, null, 1));
const tally = results.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
console.error('TALLY', JSON.stringify(tally));
