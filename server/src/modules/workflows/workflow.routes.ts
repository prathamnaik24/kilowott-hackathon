import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { parseJson } from '../../lib/json.js';
import { requireRole } from '../auth/auth.js';

export const workflowRouter = Router();

workflowRouter.get('/', async (_req, res) => {
  const workflows = await prisma.workflow.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { runs: true } } },
  });
  res.json({
    data: workflows.map((w) => ({
      ...w,
      conditions: parseJson(w.conditions, []),
      actions: parseJson(w.actions, []),
      runCount: w._count.runs,
    })),
  });
});

workflowRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  res.json({ data: await prisma.workflow.update({ where: { id: String(req.params.id) }, data: { isActive } }) });
});

/** Execution log: every automated run with per-action results. */
workflowRouter.get('/runs', async (req, res) => {
  const limit = z.coerce.number().max(200).default(50).parse(req.query.limit);
  const runs = await prisma.workflowRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      workflow: { select: { name: true, key: true } },
      customer: { select: { id: true, firstName: true, lastName: true } },
      order: { select: { id: true, number: true } },
    },
  });
  res.json({ data: runs.map((r) => ({ ...r, output: parseJson(r.output, []) })) });
});
