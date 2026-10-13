if (!process.env.DATABASE_URL?.includes('audit')) throw new Error('not audit DB');
const SRC = 'file:///D:/kilowott%20hackathon/server/src';
const { prisma } = await import(`${SRC}/lib/db.ts`);
const { summarizeCustomer, runCopilot } = await import(`${SRC}/modules/ai/ai.service.ts`);
const c = await prisma.customer.findFirstOrThrow({ where: { firstName: 'Priya' }, include: { orders: true } });
const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
const real = new Set(c.orders.map((o: { number: string }) => `#${o.number}`));
const out: unknown[] = [];
const s = await summarizeCustomer(c.id, admin.id);
const norm = s.sources.map((x: string) => (x.startsWith('#') ? x : `#${x}`));
const invalid = norm.filter((x: string) => !real.has(x));
out.push({ id: 'T-AI-05', title: 'LLM summary cites only the customer’s real orders (model override openai/gpt-oss-120b)', status: s.generatedBy === 'llm' && norm.length && !invalid.length ? 'PASS' : 'FAIL', evidence: `sources [${s.sources}] real [${[...real]}] invalid [${invalid}]; summary: ${s.summary.slice(0, 200)}` });
let cp: { steps: Array<{ tool: string }>; answer: string };
try { cp = await runCopilot('Which orders are most at risk right now? Answer in two bullets.', [], { userId: admin.id }); } catch (e) { cp = { steps: [], answer: 'ERROR: ' + (e as Error).message.slice(0, 260) }; }
out.push({ id: 'T-AI-09', title: 'Copilot calls typed CRM tools and answers (LLM mode)', status: cp.steps.length > 0 && cp.steps.every((t: { tool: string }) => !/send|sql/i.test(t.tool)) ? 'PASS' : 'FAIL', evidence: `tools: ${cp.steps.map((t: { tool: string }) => t.tool).join(', ')}; answer: ${cp.answer.slice(0, 200).replace(/\n/g, ' ')}` });
console.log(JSON.stringify(out, null, 1));
await prisma.$disconnect();
