import type { Customer } from '@prisma/client';
import { prisma } from '../../lib/db.js';
import {
  mapGuestCustomerFromOrder,
  mapWooCustomer,
  mapWooOrder,
  type MappedCustomer,
} from '../../integrations/woocommerce/woocommerce.mapper.js';
import type { WooCustomer, WooOrder } from '../../integrations/woocommerce/woocommerce.types.js';

export type ChangeSource = 'SYNC' | 'WEBHOOK' | 'CRM';

export interface CustomerUpsertResult {
  customer: Customer;
  created: boolean;
}

export interface OrderUpsertResult {
  orderId: string;
  customerId: string;
  created: boolean;
  /** true when the incoming payload was older than what we already stored */
  stale: boolean;
  statusChanged: boolean;
  previousStatus: string | null;
  newStatus: string;
}

/**
 * Idempotent customer upsert. Matches on WooCommerce id first, then on email so a guest
 * who later registers is merged into the same CRM record.
 */
export async function upsertCustomer(mapped: MappedCustomer): Promise<CustomerUpsertResult> {
  const existing =
    (mapped.wooCustomerId != null
      ? await prisma.customer.findUnique({ where: { wooCustomerId: mapped.wooCustomerId } })
      : null) ?? (mapped.email ? await prisma.customer.findUnique({ where: { email: mapped.email } }) : null);

  const data = {
    email: mapped.email,
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    phone: mapped.phone,
    city: mapped.city,
    country: mapped.country,
    wooCreatedAt: mapped.wooCreatedAt,
  };

  if (existing) {
    // Never downgrade a registered customer to guest because of a later guest order.
    const customer = await prisma.customer.update({
      where: { id: existing.id },
      data: mapped.isGuest
        ? { phone: existing.phone ?? mapped.phone, city: existing.city ?? mapped.city }
        : { ...data, wooCustomerId: mapped.wooCustomerId, isGuest: false },
    });
    return { customer, created: false };
  }
  const customer = await prisma.customer.create({
    data: { ...data, wooCustomerId: mapped.wooCustomerId, isGuest: mapped.isGuest },
  });
  return { customer, created: true };
}

export function upsertWooCustomer(woo: WooCustomer) {
  return upsertCustomer(mapWooCustomer(woo));
}

/** Resolves the CRM customer for an order: registered customer by Woo id, else guest by billing email. */
async function resolveOrderCustomer(woo: WooOrder): Promise<Customer> {
  if (woo.customer_id > 0) {
    const known = await prisma.customer.findUnique({ where: { wooCustomerId: woo.customer_id } });
    if (known) return known;
  }
  return (await upsertCustomer(mapGuestCustomerFromOrder(woo))).customer;
}

/**
 * Idempotent order upsert with status-transition detection.
 * - Replayed/duplicate payloads are no-ops (same status → no new status event).
 * - Out-of-order deliveries (older date_modified) are ignored.
 * - Order write + status event happen in one transaction.
 */
export async function upsertWooOrder(woo: WooOrder, source: ChangeSource): Promise<OrderUpsertResult> {
  const mapped = mapWooOrder(woo);
  const customer = await resolveOrderCustomer(woo);
  const existing = await prisma.order.findUnique({ where: { wooOrderId: mapped.wooOrderId } });

  if (existing && existing.wooModifiedAt > mapped.wooModifiedAt) {
    return {
      orderId: existing.id,
      customerId: existing.customerId,
      created: false,
      stale: true,
      statusChanged: false,
      previousStatus: existing.status,
      newStatus: existing.status,
    };
  }

  const data = {
    number: mapped.number,
    customerId: customer.id,
    status: mapped.status,
    currency: mapped.currency,
    total: mapped.total,
    paymentMethod: mapped.paymentMethod,
    lineItems: JSON.stringify(mapped.lineItems),
    wooCreatedAt: mapped.wooCreatedAt,
    wooModifiedAt: mapped.wooModifiedAt,
    syncedAt: new Date(),
  };
  const previousStatus = existing?.status ?? null;
  const statusChanged = previousStatus !== mapped.status;

  const order = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.order.update({ where: { id: existing.id }, data })
      : await tx.order.create({ data: { ...data, wooOrderId: mapped.wooOrderId } });
    if (statusChanged) {
      await tx.orderStatusEvent.create({
        data: {
          orderId: saved.id,
          previousStatus,
          newStatus: mapped.status,
          source,
          occurredAt: existing ? mapped.wooModifiedAt : mapped.wooCreatedAt,
        },
      });
    }
    return saved;
  });

  return {
    orderId: order.id,
    customerId: customer.id,
    created: !existing,
    stale: false,
    statusChanged: Boolean(existing) && statusChanged,
    previousStatus,
    newStatus: mapped.status,
  };
}
