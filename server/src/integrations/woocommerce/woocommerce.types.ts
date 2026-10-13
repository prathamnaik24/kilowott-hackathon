/** Subset of the WooCommerce REST API v3 resource shapes that WooPulse consumes. */

export interface WooAddress {
  first_name: string;
  last_name: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface WooCustomer {
  id: number;
  date_created_gmt: string;
  date_modified_gmt?: string;
  email: string;
  first_name: string;
  last_name: string;
  role?: string;
  username?: string;
  billing: WooAddress;
  shipping?: WooAddress;
  is_paying_customer?: boolean;
}

export interface WooLineItem {
  id: number;
  name: string;
  product_id: number;
  quantity: number;
  total: string;
  sku?: string;
  price?: number;
}

export const WOO_ORDER_STATUSES = [
  'pending',
  'processing',
  'on-hold',
  'completed',
  'cancelled',
  'refunded',
  'failed',
] as const;
export type WooOrderStatus = (typeof WOO_ORDER_STATUSES)[number];

export interface WooOrder {
  id: number;
  number: string;
  status: WooOrderStatus | string;
  currency: string;
  date_created_gmt: string;
  date_modified_gmt: string;
  total: string;
  /** 0 for guest checkout */
  customer_id: number;
  billing: WooAddress;
  shipping?: WooAddress;
  payment_method?: string;
  payment_method_title?: string;
  line_items: WooLineItem[];
}

export type WooWebhookTopic =
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  | 'order.created'
  | 'order.updated'
  | 'order.deleted';
