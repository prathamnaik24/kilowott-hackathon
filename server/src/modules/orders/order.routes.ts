import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { parseJson } from '../../lib/json.js';
import { findAtRiskOrders } from '../risk/risk.service.js';

export const orderRouter = Router();

const ListQuery = z.object({
  status: z.string().optional(),
  customerId: z.string().optional(),
  search: z.string().optional(),
  minTotal: z.coerce.number().optional(),
  maxTotal: z.coerce.number().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().min(1).max(500).default(200),
});

orderRouter.get('/', async (req, res) => {
  const q = ListQuery.parse(req.query);
  const where: Prisma.OrderWhereInput = {};
  if (q.status && q.status !== 'any') where.status = { in: q.status.split(',') };
  if (q.customerId) where.customerId = q.customerId;
  if (q.minTotal != null || q.maxTotal != null) where.total = { gte: q.minTotal, lte: q.maxTotal };
  if (q.from || q.to) where.wooCreatedAt = { gte: q.from, lte: q.to };
  if (q.search) {
    where.OR = [
      { number: { contains: q.search } },
      { customer: { email: { contains: q.search.toLowerCase() } } },
      { customer: { firstName: { contains: q.search } } },
      { customer: { lastName: { contains: q.search } } },
    ];
  }
  const orders = await prisma.order.findMany({
    where,
    orderBy: { wooCreatedAt: 'desc' },
    take: q.limit,
    include: { customer: { select: { id: true, firstName: true, lastName: true, email: true, isGuest: true } } },
  });
  res.json({ data: orders.map((o) => ({ ...o, lineItems: parseJson(o.lineItems, []) })) });
});

orderRouter.get('/at-risk', async (_req, res) => {
  res.json({ data: await findAtRiskOrders() });
});

orderRouter.get('/:id', async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      customer: true,
      statusEvents: { orderBy: { occurredAt: 'asc' } },
      activities: { orderBy: { createdAt: 'desc' } },
      workflowRuns: { orderBy: { createdAt: 'desc' }, include: { workflow: { select: { name: true } } } },
    },
  });
  if (!order) throw notFound('Order');
  const risks = (await findAtRiskOrders({ customerId: order.customerId })).find((r) => r.orderId === order.id);
  res.json({ data: { ...order, lineItems: parseJson(order.lineItems, []), risk: risks ?? null } });
});

orderRouter.get('/:id/status-history', async (req, res) => {
  res.json({
    data: await prisma.orderStatusEvent.findMany({ where: { orderId: req.params.id }, orderBy: { occurredAt: 'asc' } }),
  });
});
