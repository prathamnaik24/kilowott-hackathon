const { prisma } = await import('file:///D:/kilowott%20hackathon/server/src/lib/db.ts');
const wfs = await prisma.workflow.findMany({ include: { runs: true } });
for (const w of wfs) console.log(w.key.padEnd(26), 'runs', w.runs.length, 'statuses', [...new Set(w.runs.map((r) => r.status))].join('/') || '-');
console.log('WORKFLOW-type activities:', await prisma.activity.count({ where: { type: 'WORKFLOW' } }));
console.log('Events by status:', JSON.stringify(await prisma.webhookEvent.groupBy({ by: ['status'], _count: { _all: true } })));
await prisma.$disconnect();
