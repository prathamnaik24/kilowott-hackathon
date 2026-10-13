/**
 * Deterministic at-risk order detection. Rules decide *whether* an order is at risk (testable,
 * explainable); the LLM is only used afterwards to phrase recommendations.
 */
export type Severity = 'low' | 'medium' | 'high';

export interface RiskInput {
  order: { status: string; total: number; wooCreatedAt: Date };
  /** When the order entered its current status. */
  statusSince: Date;
  customer: { ordersCount: number; cancelledCount: number; refundedCount: number };
  now?: Date;
}

export interface RiskFlag {
  code: string;
  severity: Severity;
  reason: string;
  suggestedAction: string;
}

export const HIGH_VALUE_THRESHOLD = 200;
const HOUR = 3_600_000;

export function assessOrderRisk(input: RiskInput): RiskFlag[] {
  const now = input.now ?? new Date();
  const hoursInStatus = (now.getTime() - input.statusSince.getTime()) / HOUR;
  const { order, customer } = input;
  const flags: RiskFlag[] = [];

  if (order.status === 'on-hold' && order.total >= HIGH_VALUE_THRESHOLD) {
    flags.push({
      code: 'HIGH_VALUE_ON_HOLD',
      severity: 'high',
      reason: `High-value order (${order.total.toFixed(2)}) is on hold.`,
      suggestedAction: 'Verify payment and contact the customer today.',
    });
  }
  if (order.status === 'on-hold' && hoursInStatus >= 24) {
    flags.push({
      code: 'STALE_ON_HOLD',
      severity: hoursInStatus >= 72 ? 'high' : 'medium',
      reason: `On hold for ${Math.floor(hoursInStatus)} hours.`,
      suggestedAction: 'Resolve the hold reason or send a status update.',
    });
  }
  if (order.status === 'processing' && hoursInStatus >= 72) {
    flags.push({
      code: 'SLOW_FULFILMENT',
      severity: 'medium',
      reason: `Processing for ${Math.floor(hoursInStatus / 24)} days without shipping.`,
      suggestedAction: 'Check fulfilment and send the customer a delivery estimate.',
    });
  }
  if (order.status === 'failed' || order.status === 'pending') {
    if (hoursInStatus >= 1) {
      flags.push({
        code: 'PAYMENT_NOT_COMPLETED',
        severity: order.total >= HIGH_VALUE_THRESHOLD ? 'high' : 'medium',
        reason: `Payment ${order.status === 'failed' ? 'failed' : 'still pending'} after ${Math.floor(hoursInStatus)}h.`,
        suggestedAction: 'Send a payment-recovery email with a fresh checkout link.',
      });
    }
  }
  if (order.status === 'cancelled' && customer.ordersCount >= 3) {
    flags.push({
      code: 'LOYAL_CUSTOMER_CANCELLED',
      severity: 'high',
      reason: `A repeat customer (${customer.ordersCount} orders) cancelled this order.`,
      suggestedAction: 'Call or email to understand why and offer a goodwill gesture.',
    });
  }
  if (customer.refundedCount >= 2 && ['processing', 'on-hold'].includes(order.status)) {
    flags.push({
      code: 'REFUND_PATTERN',
      severity: 'medium',
      reason: `Customer has ${customer.refundedCount} refunded orders.`,
      suggestedAction: 'Review product fit / quality issues before shipping.',
    });
  }
  return flags;
}

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

export function highestSeverity(flags: RiskFlag[]): Severity | null {
  return flags.reduce<Severity | null>(
    (max, f) => (max === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[max] ? f.severity : max),
    null,
  );
}

export const severityRank = (s: Severity | null) => (s ? SEVERITY_RANK[s] : 0);
