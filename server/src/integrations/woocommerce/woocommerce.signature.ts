import { createHmac, timingSafeEqual } from 'node:crypto';

/** WooCommerce signs webhooks with base64(HMAC-SHA256(rawBody, secret)) in X-WC-Webhook-Signature. */
export function signWebhookBody(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signWebhookBody(rawBody, secret));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
