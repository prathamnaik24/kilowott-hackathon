import express, { Router } from 'express';
import { env } from '../../config/env.js';
import { verifyWebhookSignature } from '../../integrations/woocommerce/woocommerce.signature.js';
import { acceptWebhook } from './webhook.service.js';

export const webhookRouter = Router();

// Signature verification needs the exact raw bytes, so this route must not use express.json().
webhookRouter.post('/woocommerce', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const topic = req.header('x-wc-webhook-topic');

  // When a webhook is created in WooCommerce it sends a form-encoded "webhook_id=N" ping
  // without a topic. It must get a 2xx or WooCommerce refuses to save the webhook.
  if (!topic || raw.toString('utf8').startsWith('webhook_id=')) {
    res.status(200).json({ ok: true, ping: true });
    return;
  }

  if (!verifyWebhookSignature(raw, req.header('x-wc-webhook-signature'), env.WOO_WEBHOOK_SECRET)) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Body is not valid JSON' });
    return;
  }

  const result = await acceptWebhook({
    deliveryId: req.header('x-wc-webhook-delivery-id') ?? null,
    topic,
    payload,
  });
  // Acknowledge fast; processing happens on the queue.
  res.status(202).json({ ok: true, ...result });
});
