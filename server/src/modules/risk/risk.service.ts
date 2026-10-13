import { CacheKeys, getOrSet } from '../../lib/cache.js';
import { prisma } from '../../lib/db.js';
import { computeCustomerMetrics } from '../customers/customer.metrics.js';
import { assessOrderRisk, highestSeverity, severityRank, type RiskFlag, type Severity } from './risk.rules.js';

export interface AtRiskOrder {
  orderId: string;
  number: string;
  status: string;
  total: number;
  currency: string;
  customer: { id: string; name: string; email: string };
  severity: Severity;
  flags: RiskFlag[];
}

const OPEN_OR_RECENT = ['pending', 'processing', 'on-hold', 'failed', 'cancelled', 'completed'];

/**
 * Runs the risk rules over every relevant order and returns flagged ones, most severe first.
 * The store-wide scan is cached for 30s (time-in-status changes slowly; webhooks invalidate it).
 */
export async function findAtRiskOrders(options: { customerId?: string } = {}): Promise<AtRiskOrder[]> {
  if (!options.customerId) return getOrSet(CacheKeys.atRisk, 30, () => scanAtRiskOrders({}));
  return scanAtRiskOrders(options);
}

async function scanAtRiskOrders(options: { customerId?: string }): Promise<AtRiskOrder[]> {
  const orders = await prisma.order.findMany({
    where: { status: { in: OPEN_OR_RECENT }, ...(options.customerId ? { customerId: options.customerId } : {}) },
    include: {
      customer: { include: { orders: { select: { status: true, total: true, wooCreatedAt: true } } } },
      statusEvents: { orderBy: { occurredAt: 'desc' }, take: 1 },
    },
  });

  const flagged: AtRiskOrder[] = [];
  for (const o of orders) {
    const metrics = computeCustomerMetrics(o.customer.orders);
    const flags = assessOrderRisk({
      order: o,
      statusSince: o.statusEvents[0]?.occurredAt ?? o.wooModifiedAt,
      customer: metrics,
    });
    const severity = highestSeverity(flags);
    if (!severity) continue;
    flagged.push({
      orderId: o.id,
      number: o.number,
      status: o.status,
      total: o.total,
      currency: o.currency,
      customer: { id: o.customer.id, name: `${o.customer.firstName} ${o.customer.lastName}`.trim(), email: o.customer.email },
      severity,
      flags,
    });
  }
  return flagged.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.total - a.total);
}
