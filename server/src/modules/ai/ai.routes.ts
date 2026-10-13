import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { COPILOT_TOOL_NAMES, draftFollowUp, runCopilot, summarizeCustomer } from './ai.service.js';
import { llmEnabled } from './llm.js';

export const aiRouter = Router();

aiRouter.get('/status', (_req, res) => {
  res.json({ data: { enabled: llmEnabled(), model: llmEnabled() ? env.LLM_MODEL : null, tools: COPILOT_TOOL_NAMES } });
});

aiRouter.post('/customers/:id/summary', async (req, res) => {
  res.json({ data: await summarizeCustomer(req.params.id, req.user!.id) });
});

const DraftBody = z.object({
  orderId: z.string().optional(),
  goal: z.string().min(3).max(500),
  tone: z.enum(['friendly', 'formal', 'apologetic', 'enthusiastic']).default('friendly'),
});

aiRouter.post('/customers/:id/draft', async (req, res) => {
  const body = DraftBody.parse(req.body);
  res.json({ data: await draftFollowUp({ customerId: req.params.id, ...body }, req.user!.id) });
});

const CopilotBody = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).default([]),
  customerId: z.string().optional(),
});

aiRouter.post('/copilot', async (req, res) => {
  const { message, history, customerId } = CopilotBody.parse(req.body);
  res.json({ data: await runCopilot(message, history, { userId: req.user!.id, customerId }) });
});
