import { createHmac, randomUUID } from 'node:crypto';
import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { env } from '../config/env.js';
import { oauthSignatureBaseString } from '../integrations/woocommerce/woocommerce.oauth.js';
import { signWebhookBody } from '../integrations/woocommerce/woocommerce.signature.js';
import type { WooCustomer, WooOrder, WooWebhookTopic } from '../integrations/woocommerce/woocommerce.types.js';
import { address, generateStore, GUESTS, PEOPLE, PRODUCTS, toWooDate, type MockStoreState } from './mock-data.js';
import { renderControlPanel } from './control-panel.js';

/**
 * A WooCommerce-compatible mock store (REST API v3 subset + signed webhooks).
 *
 * It lets the CRM be demoed and tested without a WordPress install, while exercising exactly the
 * same client, signature verification and ingestion code paths as a real store.
 */
export function createMockWooRouter(options: { webhookUrl: string; basePath: string; secret?: string }) {
  const state: MockStoreState = generateStore();
  const secret = options.secret ?? env.WOO_WEBHOOK_SECRET;
  const router = Router();
  router.use(express.json());

  const deliver = async (topic: WooWebhookTopic, resource: WooOrder | WooCustomer) => {
    const body = JSON.stringify(resource);
    try {
      await fetch(options.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-WC-Webhook-Source': 'mock-woo',
          'X-WC-Webhook-Topic': topic,
          'X-WC-Webhook-Resource': topic.split('.')[0],
          'X-WC-Webhook-Event': topic.split('.')[1],
          'X-WC-Webhook-Delivery-ID': randomUUID(),
          'X-WC-Webhook-Signature': signWebhookBody(body, secret),
        },
        body,
      });
    } catch (e) {
      console.warn(`[mock-woo] webhook delivery failed for ${topic}:`, (e as Error).message);
    }
  };

  const paginate = <T,>(req: Request, res: Response, items: T[]) => {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page ?? 10)));
    res.setHeader('X-WP-Total', String(items.length));
    res.setHeader('X-WP-TotalPages', String(Math.max(1, Math.ceil(items.length / perPage))));
    res.json(items.slice((page - 1) * perPage, page * perPage));
  };

  /** Accepts Basic auth (HTTPS clients) or OAuth 1.0a query signatures (HTTP clients), like WooCommerce. */
  const requireKeys = (req: Request, res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    let authorized = false;
    if (header.startsWith('Basic ')) {
      const [user, pass] = Buffer.from(header.slice(6), 'base64').toString().split(':');
      authorized = user === env.WOO_CONSUMER_KEY && pass === env.WOO_CONSUMER_SECRET;
    } else if (typeof req.query.oauth_signature === 'string' && req.query.oauth_consumer_key === env.WOO_CONSUMER_KEY) {
      const { oauth_signature: received, ...params } = req.query as Record<string, string>;
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl.split('?')[0]}`;
      const base = oauthSignatureBaseString(req.method, url, params);
      const expected = createHmac('sha256', `${env.WOO_CONSUMER_SECRET}&`).update(base).digest('base64');
      authorized = expected === received;
    }
    if (!authorized) {
      res.status(401).json({ code: 'woocommerce_rest_cannot_view', message: 'Invalid consumer key.' });
      return;
    }
    next();
  };

  const setStatus = (order: WooOrder, status: string) => {
    order.status = status;
    order.date_modified_gmt = toWooDate(new Date());
    void deliver('order.updated', order);
    return order;
  };

  const createOrder = (customerId?: number) => {
    const customer =
      customerId != null
        ? state.customers.find((c) => c.id === customerId)
        : state.customers[Math.floor(Math.random() * state.customers.length)];
    const guest = GUESTS[Math.floor(Math.random() * GUESTS.length)];
    const billing = customer
      ? customer.billing
      : address(guest[0], guest[1], guest[2], guest[3], `${guest[0].toLowerCase()}.${guest[1].toLowerCase()}@guestmail.com`, '');
    const items = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, (_, i) => {
      const [name, price] = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
      return { id: state.nextOrderId * 10 + i, name, product_id: i + 1, quantity: 1, total: price.toFixed(2), price };
    });
    const now = toWooDate(new Date());
    const id = state.nextOrderId++;
    const order: WooOrder = {
      id,
      number: String(id),
      status: 'processing',
      currency: 'USD',
      date_created_gmt: now,
      date_modified_gmt: now,
      total: items.reduce((s, li) => s + Number(li.total), 0).toFixed(2),
      customer_id: customer?.id ?? 0,
      billing,
      shipping: billing,
      payment_method: 'razorpay',
      payment_method_title: 'Razorpay (UPI / Cards)',
      line_items: items,
    };
    state.orders.push(order);
    void deliver('order.created', order);
    return order;
  };

  const createCustomer = (input?: Partial<WooCustomer>) => {
    const [first, last, city, country] = PEOPLE[state.nextCustomerId % PEOPLE.length];
    const id = state.nextCustomerId++;
    const firstName = input?.first_name ?? `${first}`;
    const lastName = input?.last_name ?? `${last} ${id}`;
    const email = input?.email ?? `${firstName}.${id}@example.com`.toLowerCase();
    const now = toWooDate(new Date());
    const customer: WooCustomer = {
      id,
      date_created_gmt: now,
      date_modified_gmt: now,
      email,
      first_name: firstName,
      last_name: lastName,
      role: 'customer',
      username: email.split('@')[0],
      billing: address(firstName, lastName, city, country, email, ''),
      is_paying_customer: false,
    };
    state.customers.push(customer);
    void deliver('customer.created', customer);
    return customer;
  };

  // ---- WooCommerce REST API v3 subset -------------------------------------------------------
  const api = Router();
  api.use(requireKeys);
  api.get('/customers', (req, res) => paginate(req, res, state.customers));
  api.get('/customers/:id', (req, res) => {
    const c = state.customers.find((x) => x.id === Number(req.params.id));
    if (!c) return void res.status(404).json({ code: 'woocommerce_rest_invalid_id' });
    res.json(c);
  });
  api.post('/customers', (req, res) => res.status(201).json(createCustomer(req.body)));
  api.get('/orders', (req, res) => {
    const status = req.query.status as string | undefined;
    const list = [...state.orders].reverse().filter((o) => !status || status === 'any' || o.status === status);
    paginate(req, res, list);
  });
  api.get('/orders/:id', (req, res) => {
    const o = state.orders.find((x) => x.id === Number(req.params.id));
    if (!o) return void res.status(404).json({ code: 'woocommerce_rest_shop_order_invalid_id' });
    res.json(o);
  });
  api.post('/orders', (req, res) => res.status(201).json(createOrder(req.body?.customer_id)));
  api.put('/orders/:id', (req, res) => {
    const o = state.orders.find((x) => x.id === Number(req.params.id));
    if (!o) return void res.status(404).json({ code: 'woocommerce_rest_shop_order_invalid_id' });
    res.json(req.body?.status ? setStatus(o, req.body.status) : o);
  });
  router.use('/wp-json/wc/v3', api);

  // ---- "WP Admin" control panel used in the demo to simulate shop activity ---------------
  router.get('/', (_req, res) => res.type('html').send(renderControlPanel(state, options.basePath)));
  router.post('/panel/orders/:id/status', express.urlencoded({ extended: false }), (req, res) => {
    const o = state.orders.find((x) => x.id === Number(req.params.id));
    if (o && req.body.status) setStatus(o, String(req.body.status));
    res.redirect(303, `${options.basePath}/`);
  });
  router.post('/panel/orders', (_req, res) => {
    createOrder();
    res.redirect(303, `${options.basePath}/`);
  });
  router.post('/panel/customers', (_req, res) => {
    createCustomer();
    res.redirect(303, `${options.basePath}/`);
  });

  return router;
}
