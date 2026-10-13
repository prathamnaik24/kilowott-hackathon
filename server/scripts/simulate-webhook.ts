/**
 * Sends a correctly signed WooCommerce webhook to a WooPulse instance — handy for demos and for
 * testing a deployment without access to the store admin.
 *
 *   npm run simulate -w server -- <wooOrderId> <newStatus> [targetBaseUrl]
 *   npm run simulate -w server -- 5036 completed http://localhost:4000
 */
import { randomUUID } from 'node:crypto';
import { env } from '../src/config/env.js';
import { createWooClient } from '../src/integrations/woocommerce/index.js';
import { signWebhookBody } from '../src/integrations/woocommerce/woocommerce.signature.js';

const [orderId, status, target = env.PUBLIC_URL] = process.argv.slice(2);
if (!orderId || !status) {
  console.error('Usage: simulate-webhook <wooOrderId> <status> [targetBaseUrl]');
  process.exit(1);
}

const order = await createWooClient().getOrderById(Number(orderId));
const payload = { ...order, status, date_modified_gmt: new Date().toISOString().slice(0, 19) };
const body = JSON.stringify(payload);

const res = await fetch(`${target}/api/webhooks/woocommerce`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-WC-Webhook-Topic': 'order.updated',
    'X-WC-Webhook-Delivery-ID': randomUUID(),
    'X-WC-Webhook-Signature': signWebhookBody(body, env.WOO_WEBHOOK_SECRET),
  },
  body,
});
console.log(`order.updated #${orderId} → ${status}: HTTP ${res.status}`, await res.text());
