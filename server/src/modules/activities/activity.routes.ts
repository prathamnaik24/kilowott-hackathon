import { Router } from 'express';
import { z } from 'zod';
import { CacheKeys, invalidate } from '../../lib/cache.js';
import { prisma } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { sendDraft, sendEmail } from './email.service.js';

export const activityRouter = Router();

// Any activity change can alter dashboard figures (open tasks), so drop cached read models.
activityRouter.use((req, _res, next) => {
  if (req.method !== 'GET') void invalidate(CacheKeys.dashboard);
  next();
});

const CreateActivity = z.object({
  customerId: z.string(),
  orderId: z.string().optional(),
  type: z.enum(['NOTE', 'TASK', 'EMAIL']),
  title: z.string().min(1).max(200),
  body: z.string().max(10_000).default(''),
  dueAt: z.coerce.date().optional(),
  /** EMAIL only: send immediately (true) or keep as a draft for review (false). */
  send: z.boolean().default(false),
});

activityRouter.post('/', async (req, res) => {
  const input = CreateActivity.parse(req.body);
  if (input.type === 'EMAIL' && input.send) {
    const sent = await sendEmail({
      customerId: input.customerId,
      orderId: input.orderId,
      subject: input.title,
      body: input.body,
      origin: 'user',
      createdById: req.user!.id,
    });
    res.status(201).json({ data: sent });
    return;
  }
  const activity = await prisma.activity.create({
    data: {
      customerId: input.customerId,
      orderId: input.orderId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      dueAt: input.dueAt ?? null,
      status: input.type === 'TASK' ? 'OPEN' : input.type === 'EMAIL' ? 'DRAFT' : null,
      createdById: req.user!.id,
    },
  });
  res.status(201).json({ data: activity });
});

/** Open tasks across all customers (agent inbox). */
activityRouter.get('/tasks', async (_req, res) => {
  const tasks = await prisma.activity.findMany({
    where: { type: 'TASK', status: 'OPEN' },
    orderBy: { dueAt: 'asc' },
    include: { customer: { select: { id: true, firstName: true, lastName: true } } },
  });
  res.json({ data: tasks });
});

activityRouter.patch('/:id', async (req, res) => {
  const patch = z.object({ status: z.enum(['OPEN', 'DONE']).optional(), title: z.string().optional(), body: z.string().optional() }).parse(req.body);
  res.json({ data: await prisma.activity.update({ where: { id: req.params.id }, data: patch }) });
});

/** Human approval step: an agent reviews (optionally edits) an email draft, then sends it. */
activityRouter.post('/:id/send', async (req, res) => {
  const edits = z.object({ subject: z.string().optional(), body: z.string().optional() }).parse(req.body ?? {});
  try {
    res.json({ data: await sendDraft(req.params.id, req.user!.id, edits) });
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
});
