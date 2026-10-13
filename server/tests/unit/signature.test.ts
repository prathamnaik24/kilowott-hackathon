import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signWebhookBody, verifyWebhookSignature } from '../../src/integrations/woocommerce/woocommerce.signature.js';

describe('webhook signature', () => {
  const body = JSON.stringify({ id: 1, status: 'completed' });
  const secret = 's3cret';

  it('matches WooCommerce format: base64 HMAC-SHA256 of the raw body', () => {
    const expected = createHmac('sha256', secret).update(body).digest('base64');
    expect(signWebhookBody(body, secret)).toBe(expected);
  });

  it('accepts a valid signature', () => {
    expect(verifyWebhookSignature(Buffer.from(body), signWebhookBody(body, secret), secret)).toBe(true);
  });

  it('rejects tampered bodies, wrong secrets and missing signatures', () => {
    const sig = signWebhookBody(body, secret);
    expect(verifyWebhookSignature(body.replace('completed', 'refunded'), sig, secret)).toBe(false);
    expect(verifyWebhookSignature(body, sig, 'other')).toBe(false);
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'short', secret)).toBe(false);
  });
});
