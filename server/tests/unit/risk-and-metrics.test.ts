import { describe, expect, it } from 'vitest';
import { computeCustomerMetrics } from '../../src/modules/customers/customer.metrics.js';
import { assessOrderRisk, highestSeverity } from '../../src/modules/risk/risk.rules.js';

const now = new Date('2026-10-13T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const loyal = { ordersCount: 5, cancelledCount: 0, refundedCount: 0 };
const codes = (flags: { code: string }[]) => flags.map((f) => f.code);

describe('assessOrderRisk', () => {
  it('flags high-value orders stuck on hold', () => {
    const flags = assessOrderRisk({
      order: { status: 'on-hold', total: 450, wooCreatedAt: hoursAgo(50) },
      statusSince: hoursAgo(30),
      customer: loyal,
      now,
    });
    expect(codes(flags)).toEqual(['HIGH_VALUE_ON_HOLD', 'STALE_ON_HOLD']);
    expect(highestSeverity(flags)).toBe('high');
  });

  it('does not flag a fresh, low-value on-hold order', () => {
    expect(
      assessOrderRisk({ order: { status: 'on-hold', total: 40, wooCreatedAt: hoursAgo(2) }, statusSince: hoursAgo(2), customer: loyal, now }),
    ).toEqual([]);
  });

  it('flags slow fulfilment after 72h processing', () => {
    const flags = assessOrderRisk({ order: { status: 'processing', total: 60, wooCreatedAt: hoursAgo(100) }, statusSince: hoursAgo(80), customer: loyal, now });
    expect(codes(flags)).toEqual(['SLOW_FULFILMENT']);
  });

  it('flags a loyal customer cancelling, but not a first-time one', () => {
    const order = { status: 'cancelled', total: 80, wooCreatedAt: hoursAgo(10) };
    expect(codes(assessOrderRisk({ order, statusSince: hoursAgo(5), customer: loyal, now }))).toEqual(['LOYAL_CUSTOMER_CANCELLED']);
    expect(assessOrderRisk({ order, statusSince: hoursAgo(5), customer: { ...loyal, ordersCount: 1 }, now })).toEqual([]);
  });

  it('flags refund patterns on open orders', () => {
    const flags = assessOrderRisk({
      order: { status: 'processing', total: 60, wooCreatedAt: hoursAgo(5) },
      statusSince: hoursAgo(5),
      customer: { ordersCount: 4, cancelledCount: 0, refundedCount: 2 },
      now,
    });
    expect(codes(flags)).toEqual(['REFUND_PATTERN']);
  });
});

describe('computeCustomerMetrics', () => {
  it('computes LTV from kept orders only', () => {
    const m = computeCustomerMetrics([
      { status: 'completed', total: 100, wooCreatedAt: hoursAgo(300) },
      { status: 'processing', total: 50.25, wooCreatedAt: hoursAgo(10) },
      { status: 'refunded', total: 999, wooCreatedAt: hoursAgo(200) },
      { status: 'cancelled', total: 999, wooCreatedAt: hoursAgo(100) },
    ]);
    expect(m.ordersCount).toBe(4);
    expect(m.totalSpent).toBe(150.25);
    expect(m.averageOrderValue).toBe(75.13);
    expect(m.cancelledCount).toBe(1);
    expect(m.refundedCount).toBe(1);
    expect(m.lastOrderAt).toEqual(hoursAgo(10));
  });

  it('handles customers with no orders', () => {
    expect(computeCustomerMetrics([])).toMatchObject({ ordersCount: 0, totalSpent: 0, averageOrderValue: 0, lastOrderAt: null });
  });
});
