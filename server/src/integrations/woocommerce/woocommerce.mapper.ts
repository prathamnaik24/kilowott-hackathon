import type { WooCustomer, WooOrder } from './woocommerce.types.js';

/** WooCommerce sends GMT timestamps without a timezone suffix ("2026-10-13T08:00:00"). */
export function parseWooDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export interface MappedCustomer {
  wooCustomerId: number | null;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  city: string | null;
  country: string | null;
  isGuest: boolean;
  wooCreatedAt: Date | null;
}

export function mapWooCustomer(c: WooCustomer): MappedCustomer {
  return {
    wooCustomerId: c.id,
    email: normalizeEmail(c.email || c.billing?.email || ''),
    firstName: c.first_name || c.billing?.first_name || '',
    lastName: c.last_name || c.billing?.last_name || '',
    phone: c.billing?.phone || null,
    city: c.billing?.city || null,
    country: c.billing?.country || null,
    isGuest: false,
    wooCreatedAt: parseWooDate(c.date_created_gmt),
  };
}

/** Guest orders (customer_id = 0) carry the only customer info in the billing address. */
export function mapGuestCustomerFromOrder(o: WooOrder): MappedCustomer {
  return {
    wooCustomerId: null,
    email: normalizeEmail(o.billing.email ?? ''),
    firstName: o.billing.first_name || 'Guest',
    lastName: o.billing.last_name || '',
    phone: o.billing.phone || null,
    city: o.billing.city || null,
    country: o.billing.country || null,
    isGuest: true,
    wooCreatedAt: parseWooDate(o.date_created_gmt),
  };
}

export interface MappedLineItem {
  name: string;
  quantity: number;
  total: number;
}

export interface MappedOrder {
  wooOrderId: number;
  number: string;
  /** null when the order was placed via guest checkout */
  wooCustomerId: number | null;
  billingEmail: string;
  status: string;
  currency: string;
  total: number;
  paymentMethod: string | null;
  lineItems: MappedLineItem[];
  wooCreatedAt: Date;
  wooModifiedAt: Date;
}

export function mapWooOrder(o: WooOrder): MappedOrder {
  const createdAt = parseWooDate(o.date_created_gmt) ?? new Date();
  return {
    wooOrderId: o.id,
    number: String(o.number ?? o.id),
    wooCustomerId: o.customer_id > 0 ? o.customer_id : null,
    billingEmail: normalizeEmail(o.billing?.email ?? ''),
    status: o.status,
    currency: o.currency,
    total: Number.parseFloat(o.total) || 0,
    paymentMethod: o.payment_method_title || o.payment_method || null,
    lineItems: (o.line_items ?? []).map((li) => ({
      name: li.name,
      quantity: li.quantity,
      total: Number.parseFloat(li.total) || 0,
    })),
    wooCreatedAt: createdAt,
    wooModifiedAt: parseWooDate(o.date_modified_gmt) ?? createdAt,
  };
}
