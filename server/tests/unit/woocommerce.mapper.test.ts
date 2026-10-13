import { describe, expect, it } from 'vitest';
import {
  mapGuestCustomerFromOrder,
  mapWooCustomer,
  mapWooOrder,
  parseWooDate,
} from '../../src/integrations/woocommerce/woocommerce.mapper.js';
import { wooCustomer, wooOrder } from '../fixtures/woo.js';

describe('parseWooDate', () => {
  it('treats WooCommerce GMT timestamps without suffix as UTC', () => {
    expect(parseWooDate('2026-10-13T08:00:00')?.toISOString()).toBe('2026-10-13T08:00:00.000Z');
  });
  it('keeps explicit offsets and rejects garbage', () => {
    expect(parseWooDate('2026-10-13T08:00:00Z')?.toISOString()).toBe('2026-10-13T08:00:00.000Z');
    expect(parseWooDate('not a date')).toBeNull();
    expect(parseWooDate(undefined)).toBeNull();
  });
});

describe('mapWooCustomer', () => {
  it('maps contact fields and normalises email', () => {
    const mapped = mapWooCustomer(wooCustomer({ email: '  Priya.Sharma@Example.COM ' }));
    expect(mapped).toMatchObject({
      wooCustomerId: 101,
      email: 'priya.sharma@example.com',
      firstName: 'Priya',
      lastName: 'Sharma',
      city: 'Mumbai',
      isGuest: false,
    });
  });
});

describe('mapWooOrder', () => {
  it('parses money strings, line items and payment method', () => {
    const mapped = mapWooOrder(wooOrder({ total: '249.50' }));
    expect(mapped.total).toBe(249.5);
    expect(mapped.lineItems).toEqual([{ name: 'Leather Weekender Bag', quantity: 1, total: 219 }]);
    expect(mapped.paymentMethod).toBe('Razorpay (UPI / Cards)');
    expect(mapped.wooCustomerId).toBe(101);
  });

  it('treats customer_id 0 as a guest order', () => {
    const order = wooOrder({ customer_id: 0 });
    expect(mapWooOrder(order).wooCustomerId).toBeNull();
    expect(mapGuestCustomerFromOrder(order)).toMatchObject({ isGuest: true, wooCustomerId: null, email: 'priya.sharma@example.com' });
  });

  it('falls back to created date when date_modified is missing', () => {
    const mapped = mapWooOrder(wooOrder({ date_modified_gmt: '' }));
    expect(mapped.wooModifiedAt).toEqual(mapped.wooCreatedAt);
  });
});
