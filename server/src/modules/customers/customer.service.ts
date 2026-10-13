import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import { notFound } from '../../lib/errors.js';
import { parseJson } from '../../lib/json.js';
import { computeCustomerMetrics } from './customer.metrics.js';

export interface CustomerListQuery {
  search?: string;
  tag?: string;
  minSpent?: number;
  minOrders?: number;
  minCancelled?: number;
  sort?: 'totalSpent' | 'ordersCount' | 'lastOrderAt' | 'name';
  limit?: number;
}

/** Customer list with metrics derived from orders. Filtering on metrics happens in memory (fine at CRM-demo scale). */
export async function listCustomers(q: CustomerListQuery = {}) {
  const where: Prisma.CustomerWhereInput = {};
  if (q.search) {
    const s = q.search.trim();
    where.OR = [{ firstName: { contains: s } }, { lastName: { contains: s } }, { email: { contains: s.toLowerCase() } }];
    const [first, ...rest] = s.split(/\s+/);
    if (rest.length) where.OR.push({ AND: [{ firstName: { contains: first } }, { lastName: { contains: rest.join(' ') } }] });
  }
  if (q.tag) where.tags = { contains: `"${q.tag}"` };

  const customers = await prisma.customer.findMany({
    where,
    include: { orders: { select: { status: true, total: true, wooCreatedAt: true } } },
  });

  let rows = customers.map(({ orders, tags, ...c }) => ({
    ...c,
    tags: parseJson<string[]>(tags, []),
    ...computeCustomerMetrics(orders),
  }));
  if (q.minSpent != null) rows = rows.filter((r) => r.totalSpent >= q.minSpent!);
  if (q.minOrders != null) rows = rows.filter((r) => r.ordersCount >= q.minOrders!);
  if (q.minCancelled != null) rows = rows.filter((r) => r.cancelledCount >= q.minCancelled!);

  const sort = q.sort ?? 'totalSpent';
  rows.sort((a, b) => {
    if (sort === 'name') return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    if (sort === 'lastOrderAt') return (b.lastOrderAt?.getTime() ?? 0) - (a.lastOrderAt?.getTime() ?? 0);
    return b[sort] - a[sort];
  });
  return q.limit ? rows.slice(0, q.limit) : rows;
}

export async function getCustomer360(id: string) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: { orders: { orderBy: { wooCreatedAt: 'desc' } } },
  });
  if (!customer) throw notFound('Customer');
  const { orders, tags, ...rest } = customer;
  return {
    ...rest,
    tags: parseJson<string[]>(tags, []),
    metrics: computeCustomerMetrics(orders),
    orders: orders.map((o) => ({ ...o, lineItems: parseJson(o.lineItems, []) })),
  };
}

export type TimelineItem = {
  id: string;
  kind: 'ORDER_PLACED' | 'STATUS_CHANGE' | 'NOTE' | 'TASK' | 'EMAIL' | 'AI_SUMMARY' | 'WORKFLOW';
  at: Date;
  title: string;
  body?: string;
  status?: string | null;
  origin?: string;
  orderNumber?: string;
  activityId?: string;
  dueAt?: Date | null;
};

/** Merged, newest-first feed of orders, status transitions, notes, tasks, emails and AI insights. */
export async function getCustomerTimeline(id: string): Promise<TimelineItem[]> {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      orders: { include: { statusEvents: true } },
      activities: { include: { order: { select: { number: true } } } },
    },
  });
  if (!customer) throw notFound('Customer');

  const items: TimelineItem[] = [];
  for (const o of customer.orders) {
    items.push({ id: `order-${o.id}`, kind: 'ORDER_PLACED', at: o.wooCreatedAt, title: `Placed order #${o.number}`, body: `${o.currency} ${o.total.toFixed(2)}`, orderNumber: o.number });
    for (const e of o.statusEvents) {
      if (!e.previousStatus) continue;
      items.push({
        id: e.id,
        kind: 'STATUS_CHANGE',
        at: e.occurredAt,
        title: `Order #${o.number}: ${e.previousStatus} → ${e.newStatus}`,
        origin: e.source,
        orderNumber: o.number,
      });
    }
  }
  for (const a of customer.activities) {
    items.push({
      id: a.id,
      activityId: a.id,
      kind: a.type as TimelineItem['kind'],
      at: a.createdAt,
      title: a.title,
      body: a.body,
      status: a.status,
      origin: a.origin,
      orderNumber: a.order?.number,
      dueAt: a.dueAt,
    });
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export async function updateCustomerTags(id: string, tags: string[]) {
  const unique = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  await prisma.customer.update({ where: { id }, data: { tags: JSON.stringify(unique) } });
  return unique;
}
