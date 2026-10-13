import { z } from 'zod';
import { prisma } from '../../lib/db.js';
import { getCustomer360, getCustomerTimeline, listCustomers } from '../customers/customer.service.js';
import { findAtRiskOrders } from '../risk/risk.service.js';
import type { ToolDefinition } from './llm.js';

/**
 * Tools the CRM copilot can call. Each tool validates its arguments with zod and returns a
 * compact JSON-serialisable result. There is deliberately NO send_email tool: the agent may
 * draft, but sending always requires a human click in the UI.
 */
interface CrmTool<A extends z.ZodTypeAny> {
  description: string;
  schema: A;
  parameters: Record<string, unknown>;
  /** Writes to the CRM (surfaced to the user as an action, not just a lookup). */
  mutates?: boolean;
  run: (args: z.infer<A>, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  userId: string;
}

const tool = <A extends z.ZodTypeAny>(t: CrmTool<A>) => t;

const shortCustomer = (c: { id: string; firstName: string; lastName: string; email: string }) => ({
  id: c.id,
  name: `${c.firstName} ${c.lastName}`.trim(),
  email: c.email,
});

export const CRM_TOOLS = {
  search_customers: tool({
    description:
      'Search and filter customers. Returns id, name, email, lifetime value, order and cancellation counts. ' +
      'Use minCancelled for "customers with N+ cancelled orders".',
    schema: z.object({
      query: z.string().optional(),
      tag: z.string().optional(),
      minSpent: z.number().optional(),
      minOrders: z.number().optional(),
      minCancelled: z.number().optional(),
      limit: z.number().default(10),
    }),
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or email fragment' },
        tag: { type: 'string', description: 'Customer tag, e.g. vip, churn-risk' },
        minSpent: { type: 'number', description: 'Minimum lifetime spend' },
        minOrders: { type: 'number', description: 'Minimum number of orders' },
        minCancelled: { type: 'number', description: 'Minimum number of cancelled orders' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
    },
    run: async (a) =>
      (await listCustomers({ search: a.query, tag: a.tag, minSpent: a.minSpent, minOrders: a.minOrders, minCancelled: a.minCancelled, limit: a.limit })).map(
        (c) => ({ ...shortCustomer(c), totalSpent: c.totalSpent, ordersCount: c.ordersCount, cancelledCount: c.cancelledCount, refundedCount: c.refundedCount, tags: c.tags }),
      ),
  }),

  get_customer_profile: tool({
    description: 'Full profile of one customer: contact details, metrics, tags and every order with items.',
    schema: z.object({ customerId: z.string() }),
    parameters: { type: 'object', properties: { customerId: { type: 'string' } }, required: ['customerId'] },
    run: async ({ customerId }) => {
      const c = await getCustomer360(customerId);
      return {
        ...shortCustomer(c),
        city: c.city,
        country: c.country,
        isGuest: c.isGuest,
        tags: c.tags,
        metrics: c.metrics,
        orders: c.orders.map((o) => ({ id: o.id, number: o.number, status: o.status, total: o.total, currency: o.currency, createdAt: o.wooCreatedAt, items: o.lineItems })),
      };
    },
  }),

  get_customer_timeline: tool({
    description: 'Chronological activity for a customer: orders, status changes, notes, tasks, emails, AI insights (latest 25).',
    schema: z.object({ customerId: z.string() }),
    parameters: { type: 'object', properties: { customerId: { type: 'string' } }, required: ['customerId'] },
    run: async ({ customerId }) =>
      (await getCustomerTimeline(customerId)).slice(0, 25).map((t) => ({ kind: t.kind, at: t.at, title: t.title, status: t.status })),
  }),

  list_orders: tool({
    description: 'List orders, optionally by status (pending, processing, on-hold, completed, cancelled, refunded, failed) or customer.',
    schema: z.object({ status: z.string().optional(), customerId: z.string().optional(), limit: z.number().default(15) }),
    parameters: {
      type: 'object',
      properties: { status: { type: 'string' }, customerId: { type: 'string' }, limit: { type: 'number' } },
    },
    run: async (a) => {
      const orders = await prisma.order.findMany({
        where: { ...(a.status ? { status: a.status } : {}), ...(a.customerId ? { customerId: a.customerId } : {}) },
        orderBy: { wooCreatedAt: 'desc' },
        take: a.limit,
        include: { customer: true },
      });
      return orders.map((o) => ({ id: o.id, number: o.number, status: o.status, total: o.total, currency: o.currency, createdAt: o.wooCreatedAt, customer: shortCustomer(o.customer) }));
    },
  }),

  get_at_risk_orders: tool({
    description: 'Orders flagged by the risk rules (long on-hold, failed payment, slow fulfilment, loyal-customer cancellation, refund pattern), most severe first.',
    schema: z.object({ customerId: z.string().optional() }),
    parameters: { type: 'object', properties: { customerId: { type: 'string' } } },
    run: async ({ customerId }) => findAtRiskOrders({ customerId }),
  }),

  create_task: tool({
    description: 'Create a follow-up task on a customer (optionally linked to an order).',
    schema: z.object({ customerId: z.string(), orderId: z.string().optional(), title: z.string(), body: z.string().default(''), dueInHours: z.number().default(24) }),
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        orderId: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        dueInHours: { type: 'number' },
      },
      required: ['customerId', 'title'],
    },
    mutates: true,
    run: async (a, ctx) => {
      const task = await prisma.activity.create({
        data: {
          customerId: a.customerId,
          orderId: a.orderId ?? null,
          type: 'TASK',
          status: 'OPEN',
          title: a.title,
          body: a.body,
          dueAt: new Date(Date.now() + a.dueInHours * 3_600_000),
          origin: 'ai',
          createdById: ctx.userId,
        },
      });
      return { taskId: task.id, title: task.title };
    },
  }),

  draft_email: tool({
    description: 'Save an email DRAFT to a customer timeline for human review. It is NOT sent; an agent must approve it in the UI.',
    schema: z.object({ customerId: z.string(), orderId: z.string().optional(), subject: z.string(), body: z.string() }),
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        orderId: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['customerId', 'subject', 'body'],
    },
    mutates: true,
    run: async (a, ctx) => {
      const draft = await prisma.activity.create({
        data: {
          customerId: a.customerId,
          orderId: a.orderId ?? null,
          type: 'EMAIL',
          status: 'DRAFT',
          title: a.subject,
          body: a.body,
          origin: 'ai',
          createdById: ctx.userId,
        },
      });
      return { draftId: draft.id, status: 'DRAFT — awaiting human approval' };
    },
  }),
};

export type CrmToolName = keyof typeof CRM_TOOLS;

export const TOOL_DEFINITIONS: ToolDefinition[] = Object.entries(CRM_TOOLS).map(([name, t]) => ({
  type: 'function',
  function: { name, description: t.description, parameters: t.parameters },
}));

export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<{ result: unknown; mutates: boolean }> {
  const t = CRM_TOOLS[name as CrmToolName] as CrmTool<z.ZodTypeAny> | undefined;
  if (!t) return { result: { error: `Unknown tool ${name}` }, mutates: false };
  let parsedArgs: unknown;
  try {
    parsedArgs = t.schema.parse(rawArgs ? JSON.parse(rawArgs) : {});
  } catch (e) {
    return { result: { error: `Invalid arguments: ${(e as Error).message}` }, mutates: false };
  }
  try {
    return { result: await t.run(parsedArgs, ctx), mutates: Boolean(t.mutates) };
  } catch (e) {
    return { result: { error: (e as Error).message }, mutates: false };
  }
}
