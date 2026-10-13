import { prisma } from '../../lib/db.js';
import { parseJson } from '../../lib/json.js';
import { renderTemplate } from '../../lib/template.js';
import { sendEmail } from '../activities/email.service.js';
import { computeCustomerMetrics } from '../customers/customer.metrics.js';
import { evaluateConditions } from './conditions.js';
import {
  ActionSchema,
  type ActionResult,
  type Condition,
  type WorkflowAction,
  type WorkflowContext,
  type WorkflowTrigger,
} from './workflow.types.js';

export interface TriggerEvent {
  trigger: WorkflowTrigger;
  customerId: string;
  orderId?: string;
  previousStatus?: string | null;
}

/** Builds the read-only context that workflow conditions and templates see. */
export async function buildContext(event: TriggerEvent): Promise<WorkflowContext> {
  const customer = await prisma.customer.findUniqueOrThrow({
    where: { id: event.customerId },
    include: { orders: { select: { status: true, total: true, wooCreatedAt: true } } },
  });
  const metrics = computeCustomerMetrics(customer.orders);
  const context: WorkflowContext = {
    customer: {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      ordersCount: metrics.ordersCount,
      totalSpent: metrics.totalSpent,
      tags: parseJson<string[]>(customer.tags, []),
    },
  };
  if (event.orderId) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: event.orderId } });
    context.order = {
      id: order.id,
      number: order.number,
      status: order.status,
      previousStatus: event.previousStatus ?? null,
      newStatus: order.status,
      total: order.total,
      currency: order.currency,
    };
  }
  return context;
}

/** Evaluates every active workflow for the trigger and executes matching ones. Each run is logged. */
export async function runWorkflows(event: TriggerEvent) {
  const workflows = await prisma.workflow.findMany({ where: { trigger: event.trigger, isActive: true } });
  if (workflows.length === 0) return [];

  const context = await buildContext(event);
  const runs = [];
  for (const wf of workflows) {
    const conditions = parseJson<Condition[]>(wf.conditions, []);
    if (!evaluateConditions(conditions, context)) continue;

    const actions = parseJson<unknown[]>(wf.actions, []).map((a) => ActionSchema.parse(a));
    const results: ActionResult[] = [];
    let error: string | null = null;
    for (const action of actions) {
      try {
        results.push(await executeAction(action, context, wf.key));
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        results.push({ type: action.type, ok: false, detail: error });
      }
    }
    runs.push(
      await prisma.workflowRun.create({
        data: {
          workflowId: wf.id,
          customerId: event.customerId,
          orderId: event.orderId ?? null,
          status: error ? 'FAILED' : 'SUCCESS',
          output: JSON.stringify(results),
          error,
        },
      }),
    );
  }
  return runs;
}

async function executeAction(action: WorkflowAction, ctx: WorkflowContext, workflowKey: string): Promise<ActionResult> {
  const render = (s: string) => renderTemplate(s, ctx as unknown as Record<string, unknown>);
  const origin = `workflow:${workflowKey}`;

  switch (action.type) {
    case 'CREATE_TASK': {
      const task = await prisma.activity.create({
        data: {
          customerId: ctx.customer.id,
          orderId: ctx.order?.id ?? null,
          type: 'TASK',
          status: 'OPEN',
          title: render(action.title),
          body: render(action.body),
          dueAt: new Date(Date.now() + action.dueInHours * 3_600_000),
          origin,
        },
      });
      return { type: action.type, ok: true, detail: `Created task "${task.title}"` };
    }
    case 'SEND_EMAIL': {
      const email = await sendEmail({
        customerId: ctx.customer.id,
        orderId: ctx.order?.id,
        subject: render(action.subject),
        body: render(action.body),
        origin,
      });
      return { type: action.type, ok: true, detail: `Sent email "${email.title}" to ${ctx.customer.email}` };
    }
    case 'ADD_TAG': {
      const tags = new Set(ctx.customer.tags);
      tags.add(action.tag);
      ctx.customer.tags = [...tags];
      await prisma.customer.update({ where: { id: ctx.customer.id }, data: { tags: JSON.stringify(ctx.customer.tags) } });
      return { type: action.type, ok: true, detail: `Tagged customer "${action.tag}"` };
    }
  }
}
