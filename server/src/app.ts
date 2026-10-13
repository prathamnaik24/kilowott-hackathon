import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { HttpError } from './lib/errors.js';
import { createMockWooRouter } from './mock-woo/mock-woo.router.js';
import { activityRouter } from './modules/activities/activity.routes.js';
import { aiRouter } from './modules/ai/ai.routes.js';
import { LlmUnavailableError } from './modules/ai/llm.js';
import { authRouter, requireAuth } from './modules/auth/auth.js';
import { customerRouter } from './modules/customers/customer.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { orderRouter } from './modules/orders/order.routes.js';
import { storeRouter } from './modules/store/store.routes.js';
import { webhookRouter } from './modules/webhooks/webhook.routes.js';
import { workflowRouter } from './modules/workflows/workflow.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());

  // Webhooks first: they need the raw body for HMAC verification.
  app.use('/api/webhooks', webhookRouter);

  if (env.MOCK_WOO_ENABLED) {
    app.use(
      '/mock-woo',
      createMockWooRouter({
        basePath: '/mock-woo',
        webhookUrl: `http://127.0.0.1:${env.PORT}/api/webhooks/woocommerce`,
      }),
    );
  }

  app.use(express.json({ limit: '1mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);

  const api = Router();
  api.use(requireAuth);
  api.use('/dashboard', dashboardRouter);
  api.use('/customers', customerRouter);
  api.use('/orders', orderRouter);
  api.use('/activities', activityRouter);
  api.use('/workflows', workflowRouter);
  api.use('/store', storeRouter);
  api.use('/ai', aiRouter);
  app.use('/api', api);

  // Serve the built React app (single-service deployment).
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api|\/mock-woo).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.issues });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err instanceof LlmUnavailableError) {
      res.status(503).json({ error: err.message });
      return;
    }
    if ((err as { code?: string })?.code === 'P2025') {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
