/** Statuses that represent money actually kept by the store. */
export const REVENUE_STATUSES = new Set(['processing', 'on-hold', 'completed']);

export interface OrderLike {
  status: string;
  total: number;
  wooCreatedAt: Date;
}

export interface CustomerMetrics {
  ordersCount: number;
  /** Lifetime value: sum of non-cancelled, non-refunded, non-failed orders. */
  totalSpent: number;
  averageOrderValue: number;
  cancelledCount: number;
  refundedCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

/**
 * WooCommerce REST v3 no longer returns orders_count / total_spent on customers, and guest
 * orders never appear there, so the CRM derives metrics from its own orders table.
 */
export function computeCustomerMetrics(orders: OrderLike[]): CustomerMetrics {
  const revenueOrders = orders.filter((o) => REVENUE_STATUSES.has(o.status));
  const totalSpent = round2(revenueOrders.reduce((sum, o) => sum + o.total, 0));
  const dates = orders.map((o) => o.wooCreatedAt.getTime()).sort((a, b) => a - b);
  return {
    ordersCount: orders.length,
    totalSpent,
    averageOrderValue: revenueOrders.length ? round2(totalSpent / revenueOrders.length) : 0,
    cancelledCount: orders.filter((o) => o.status === 'cancelled').length,
    refundedCount: orders.filter((o) => o.status === 'refunded').length,
    firstOrderAt: dates.length ? new Date(dates[0]) : null,
    lastOrderAt: dates.length ? new Date(dates[dates.length - 1]) : null,
  };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
