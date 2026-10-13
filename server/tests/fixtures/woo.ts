import type { WooCustomer, WooOrder } from '../../src/integrations/woocommerce/woocommerce.types.js';

const billing = {
  first_name: 'Priya',
  last_name: 'Sharma',
  city: 'Mumbai',
  country: 'IN',
  email: 'priya.sharma@example.com',
  phone: '+91 9800000000',
};

export function wooCustomer(overrides: Partial<WooCustomer> = {}): WooCustomer {
  return {
    id: 101,
    date_created_gmt: '2026-01-01T10:00:00',
    email: 'priya.sharma@example.com',
    first_name: 'Priya',
    last_name: 'Sharma',
    billing,
    ...overrides,
  };
}

export function wooOrder(overrides: Partial<WooOrder> = {}): WooOrder {
  return {
    id: 9001,
    number: '9001',
    status: 'processing',
    currency: 'USD',
    date_created_gmt: '2026-10-01T10:00:00',
    date_modified_gmt: '2026-10-01T10:00:00',
    total: '219.00',
    customer_id: 101,
    billing,
    payment_method: 'razorpay',
    payment_method_title: 'Razorpay (UPI / Cards)',
    line_items: [{ id: 1, name: 'Leather Weekender Bag', product_id: 6, quantity: 1, total: '219.00' }],
    ...overrides,
  };
}
