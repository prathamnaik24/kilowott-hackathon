import { Router } from 'express';
import { CacheKeys, getOrSet } from '../../lib/cache.js';
import { prisma } from '../../lib/db.js';
import { REVENUE_STATUSES, round2 } from '../customers/customer.metrics.js';
import { findAtRiskOrders } from '../risk/risk.service.js';

export const dashboardRouter = Router();

/** Cached for 30s (cache-aside); the worker invalidates it whenever a webhook changes data. */
dashboardRouter.get('/', async (_req, res) => {
  res.json({ data: await getOrSet(CacheKeys.dashboard, 30, computeDashboard) });
});

async function computeDashboard() {
  const [customerCount, byStatus, recentOrders, openTasks, recentRuns, atRisk] = await Promise.all([
    prisma.customer.count(),
    prisma.order.groupBy({ by: ['status'], _count: { _all: true }, _sum: { total: true } }),
    prisma.order.findMany({
      orderBy: { wooCreatedAt: 'desc' },
      take: 8,
      include: { customer: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.activity.count({ where: { type: 'TASK', status: 'OPEN' } }),
    prisma.workflowRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      include: { workflow: { select: { name: true } }, customer: { select: { firstName: true, lastName: true } } },
    }),
    findAtRiskOrders(),
  ]);

  const ordersByStatus = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
  const revenue = round2(
    byStatus.filter((s) => REVENUE_STATUSES.has(s.status)).reduce((sum, s) => sum + (s._sum.total ?? 0), 0),
  );
  const orderCount = byStatus.reduce((sum, s) => sum + s._count._all, 0);

  return {
    kpis: { customers: customerCount, orders: orderCount, revenue, openTasks, atRisk: atRisk.length },
    ordersByStatus,
    recentOrders,
    recentRuns,
    atRisk: atRisk.slice(0, 6),
  };
}
