// AUDIT-R2 deep probes. Requires DATABASE_URL pointing at the isolated scratchpad audit DB.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

if (!process.env.DATABASE_URL?.includes('scratchpad') || !process.env.DATABASE_URL.includes('audit')) {
  throw new Error('Refusing: DATABASE_URL is not the isolated audit DB');
}
const SRC = 'file:///D:/kilowott%20hackathon/server/src';
const SERVER_DIR = 'D:/kilowott hackathon/server';
const { prisma } = await import(`${SRC}/lib/db.ts`);
const { requeueEvents, webhookQueue } = await import(`${SRC}/modules/webhooks/webhook.service.ts`);
const { summarizeCustomer } = await import(`${SRC}/modules/ai/ai.service.ts`);
const { llmEnabled } = await import(`${SRC}/modules/ai/llm.ts`);

const out: Array<{ id: string; title: string; status: string; evidence: string }> = [];
const rec = (id: string, title: string, status: string, evidence: string) => out.push({ id, title, status, evidence });

// 1. Retry FAILED events (admin "Retry failed events" path) — must be safe and not duplicate side effects
const runsBefore = await prisma.workflowRun.count();
const activitiesBefore = await prisma.activity.count();
const failedBefore = await prisma.webhookEvent.findMany({ where: { status: 'FAILED' }, select: { id: true } });
const requeued = await requeueEvents(['FAILED']);
await webhookQueue.onIdle();
const after = await prisma.webhookEvent.findMany({ where: { id: { in: failedBefore.map((e) => e.id) } }, select: { status: true, attempts: true } });
const runsAfter = await prisma.workflowRun.count();
const activitiesAfter = await prisma.activity.count();
rec('T-WEBHOOK-08b', 'Retrying FAILED events re-processes them safely (no crash, no duplicate side effects)',
  requeued === failedBefore.length && runsAfter === runsBefore && activitiesAfter === activitiesBefore ? 'PASS' : 'FAIL',
  `requeued ${requeued}; statuses after: ${after.map((e) => `${e.status}/${e.attempts}`).join(', ')}; runs ${runsBefore}→${runsAfter}; activities ${activitiesBefore}→${activitiesAfter}`);
rec('T-QUEUE-06', 'Retried events do not duplicate workflow runs or activities', runsAfter === runsBefore && activitiesAfter === activitiesBefore ? 'PASS' : 'FAIL', `runs ${runsBefore}→${runsAfter}, activities ${activitiesBefore}→${activitiesAfter}`);

// 2. Production defaults: does config refuse insecure defaults / enable mock in production?
const prodEnv: Record<string, string> = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', NODE_ENV: 'production', ENV_FILE: path.join(SERVER_DIR, '__no_such_env_file__') };
const prod = spawnSync(process.execPath, ['--import', 'tsx', '-e', "import('./src/config/env.ts').then(m=>console.log(JSON.stringify({mock:m.env.MOCK_WOO_ENABLED, jwtDefault:m.env.JWT_SECRET==='dev-only-change-me', webhookDefault:m.env.WOO_WEBHOOK_SECRET==='woopulse-webhook-secret', adminDefault:m.env.ADMIN_PASSWORD==='demo1234'}))).catch(e=>{console.log('REJECTED:'+e.message.split('\\n')[0]);})"], { cwd: SERVER_DIR, env: prodEnv, encoding: 'utf8' });
const prodOut = (prod.stdout || prod.stderr).trim().split('\n').pop() ?? '';
const prodCfg = prodOut.startsWith('{') ? JSON.parse(prodOut) : null;
rec('T-ARCH-09', 'Mock WooCommerce is disabled by default in production', prodCfg && prodCfg.mock === false ? 'PASS' : 'FAIL', `NODE_ENV=production, no env → ${prodOut}`);
rec('T-SEC-13', 'Insecure default secrets are rejected in production', !prodCfg ? 'PASS' : 'FAIL', `NODE_ENV=production with default secrets → ${prodCfg ? 'config accepted (jwtDefault/webhookDefault/adminDefault = ' + [prodCfg.jwtDefault, prodCfg.webhookDefault, prodCfg.adminDefault].join('/') + ')' : prodOut}`);

// 3. Standalone worker without Redis
const w = spawnSync(process.execPath, ['--import', 'tsx', 'src/worker.ts'], { cwd: SERVER_DIR, env: { ...process.env, REDIS_URL: '' }, encoding: 'utf8', timeout: 60_000 });
rec('T-QUEUE-09', 'Worker starts independently and explains in-process mode when REDIS_URL is unset', w.status === 0 && /REDIS_URL is not set/.test(w.stdout) ? 'PASS' : 'FAIL', `exit ${w.status}: ${w.stdout.trim().split('\n').pop()}`);

// 4. LLM-mode grounding (uses the LLM key from server/.env if present; key never printed)
if (llmEnabled()) {
  const customer = await prisma.customer.findFirstOrThrow({ where: { firstName: 'Priya' }, include: { orders: true } });
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  try {
    const insight = await summarizeCustomer(customer.id, admin.id);
    const real = new Set(customer.orders.map((o) => `#${o.number}`));
    const norm = insight.sources.map((s) => (s.startsWith('#') ? s : `#${s}`));
    const invalid = norm.filter((s) => !real.has(s));
    rec('T-AI-05', 'LLM summary cites only the customer\u2019s real orders', insight.generatedBy === 'llm' && norm.length > 0 && invalid.length === 0 ? 'PASS' : 'FAIL',
      `generatedBy ${insight.generatedBy}; sources [${insight.sources.join(', ')}]; real orders [${[...real].join(', ')}]; invalid [${invalid.join(', ')}]`);
    rec('T-AI-05b', 'Summary is grounded in actual metrics (lifetime value mentioned matches CRM)', 'NEEDS REVIEW', `summary: "${insight.summary.slice(0, 220)}"`);
  } catch (e) {
    rec('T-AI-05', 'LLM summary cites only the customer\u2019s real orders', 'BLOCKED', `LLM call failed: ${(e as Error).message.slice(0, 160)}`);
  }
} else {
  rec('T-AI-05', 'LLM summary cites only the customer\u2019s real orders', 'BLOCKED', 'no LLM key configured');
}

// 5. Frontend never references WooCommerce directly or holds credentials
const grep = spawnSync('git', ['grep', '-nIE', 'ck_[a-z0-9]|cs_[a-z0-9]|consumer_(key|secret)|wp-json|WOO_', '--', 'client/src'], { cwd: path.dirname(SERVER_DIR), encoding: 'utf8' });
rec('T-ARCH-02', 'No WooCommerce credentials or direct WooCommerce URLs in frontend code', grep.stdout.trim() === '' ? 'PASS' : 'FAIL', grep.stdout.trim() || 'git grep over client/src: 0 matches');

console.log(JSON.stringify(out, null, 1));
await prisma.$disconnect();
process.exit(0);
