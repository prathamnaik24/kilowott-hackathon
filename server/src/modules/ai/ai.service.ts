import { prisma } from '../../lib/db.js';
import { getCustomer360, getCustomerTimeline } from '../customers/customer.service.js';
import { findAtRiskOrders } from '../risk/risk.service.js';
import { CRM_TOOLS, TOOL_DEFINITIONS, runTool, type ToolContext } from './crm-tools.js';
import { chat, chatJson, llmEnabled, type ChatMessage } from './llm.js';

export interface CustomerInsight {
  summary: string;
  purchaseBehavior: string;
  risks: string[];
  nextBestAction: string;
  /** Order numbers / records the insight was grounded on. */
  sources: string[];
  generatedBy: 'llm' | 'rules';
}

/** Compact, factual context handed to the model. Everything the model may cite is in here. */
async function buildCustomerContext(customerId: string) {
  const [c, timeline, risks] = await Promise.all([
    getCustomer360(customerId),
    getCustomerTimeline(customerId),
    findAtRiskOrders({ customerId }),
  ]);
  return {
    customer: c,
    risks,
    prompt: JSON.stringify({
      name: `${c.firstName} ${c.lastName}`,
      email: c.email,
      location: [c.city, c.country].filter(Boolean).join(', '),
      guestCheckout: c.isGuest,
      tags: c.tags,
      metrics: c.metrics,
      orders: c.orders.map((o) => ({
        number: o.number,
        status: o.status,
        total: `${o.currency} ${o.total.toFixed(2)}`,
        date: o.wooCreatedAt.toISOString().slice(0, 10),
        items: (o.lineItems as Array<{ name: string; quantity: number }>).map((li) => `${li.quantity}× ${li.name}`),
      })),
      riskFlags: risks.flatMap((r) => r.flags.map((f) => ({ order: r.number, ...f }))),
      recentActivity: timeline
        .filter((t) => !['ORDER_PLACED'].includes(t.kind))
        .slice(0, 12)
        .map((t) => ({ kind: t.kind, date: t.at.toISOString().slice(0, 10), title: t.title, status: t.status })),
    }),
  };
}

export async function summarizeCustomer(customerId: string, userId: string): Promise<CustomerInsight> {
  const { customer, risks, prompt } = await buildCustomerContext(customerId);
  let insight: CustomerInsight;

  if (llmEnabled()) {
    const result = await chatJson<Omit<CustomerInsight, 'generatedBy'>>([
      {
        role: 'system',
        content:
          'You are a CRM analyst for a WooCommerce store. Using ONLY the JSON data provided, return a JSON object with keys: ' +
          '"summary" (2-3 sentences), "purchaseBehavior" (1-2 sentences on what/when/how much they buy), ' +
          '"risks" (array of short strings, empty if none), "nextBestAction" (one concrete action for a support agent), ' +
          '"sources" (array of order numbers like "#5012" that support your statements). Never invent orders or facts.',
      },
      { role: 'user', content: prompt },
    ]);
    insight = {
      summary: String(result.summary ?? ''),
      purchaseBehavior: String(result.purchaseBehavior ?? ''),
      risks: Array.isArray(result.risks) ? result.risks.map(String) : [],
      nextBestAction: String(result.nextBestAction ?? ''),
      sources: Array.isArray(result.sources) ? result.sources.map(String) : [],
      generatedBy: 'llm',
    };
  } else {
    insight = ruleBasedInsight(customer, risks);
  }

  await prisma.activity.create({
    data: {
      customerId,
      type: 'AI_SUMMARY',
      title: 'AI customer summary',
      body: `${insight.summary}\n\nNext best action: ${insight.nextBestAction}`,
      origin: 'ai',
      createdById: userId,
    },
  });
  return insight;
}

/** Deterministic fallback so the feature still works without an LLM key. */
function ruleBasedInsight(
  c: Awaited<ReturnType<typeof getCustomer360>>,
  risks: Awaited<ReturnType<typeof findAtRiskOrders>>,
): CustomerInsight {
  const m = c.metrics;
  const tier = m.totalSpent >= 500 ? 'high-value' : m.ordersCount >= 3 ? 'repeat' : 'new';
  const flags = risks.flatMap((r) => r.flags.map((f) => `#${r.number}: ${f.reason}`));
  return {
    summary: `${c.firstName} is a ${tier} customer with ${m.ordersCount} orders and a lifetime value of ${m.totalSpent.toFixed(2)}.`,
    purchaseBehavior: `Average order value ${m.averageOrderValue.toFixed(2)}; last order on ${m.lastOrderAt?.toISOString().slice(0, 10) ?? 'n/a'}.`,
    risks: flags,
    nextBestAction: risks[0]?.flags[0]?.suggestedAction ?? 'Send a personalised thank-you and recommend a related product.',
    sources: c.orders.slice(0, 5).map((o) => `#${o.number}`),
    generatedBy: 'rules',
  };
}

export interface DraftRequest {
  customerId: string;
  orderId?: string;
  goal: string;
  tone: 'friendly' | 'formal' | 'apologetic' | 'enthusiastic';
}

/** Drafts a follow-up email and stores it as a DRAFT activity. Sending requires human approval. */
export async function draftFollowUp(req: DraftRequest, userId: string) {
  const { customer, prompt } = await buildCustomerContext(req.customerId);
  const order = req.orderId ? customer.orders.find((o) => o.id === req.orderId) : undefined;
  let draft: { subject: string; body: string };

  if (llmEnabled()) {
    draft = await chatJson<{ subject: string; body: string }>([
      {
        role: 'system',
        content:
          'You write customer emails for a WooCommerce store support team. Return JSON {"subject": string, "body": string}. ' +
          'Use only facts in the provided data. Plain text body, under 140 words, sign off as "The Store Team". ' +
          'Do not promise refunds, discounts or dates that are not in the data.',
      },
      {
        role: 'user',
        content: `Goal: ${req.goal}\nTone: ${req.tone}\n${order ? `Focus order: #${order.number} (${order.status})\n` : ''}Customer data: ${prompt}`,
      },
    ]);
  } else {
    draft = {
      subject: order ? `About your order #${order.number}` : `A quick note from our team`,
      body: `Hi ${customer.firstName},\n\n${req.goal}.${order ? ` Your order #${order.number} is currently "${order.status}".` : ''}\n\nIf you have any questions, just reply to this email.\n\nThe Store Team`,
    };
  }

  const activity = await prisma.activity.create({
    data: {
      customerId: req.customerId,
      orderId: req.orderId ?? null,
      type: 'EMAIL',
      status: 'DRAFT',
      title: String(draft.subject),
      body: String(draft.body),
      origin: 'ai',
      createdById: userId,
    },
  });
  return { draftId: activity.id, subject: activity.title, body: activity.body, generatedBy: llmEnabled() ? 'llm' : 'rules' };
}

export interface CopilotStep {
  tool: string;
  args: unknown;
  mutates: boolean;
  resultPreview: string;
}

const COPILOT_SYSTEM = `You are WooPulse Copilot, an AI agent inside a CRM for a WooCommerce store.
- Always use tools to look up real data before answering; never guess customer or order facts.
- To find a customer by name, call search_customers first, then use the returned id.
- You may create tasks and save email DRAFTS. You can NEVER send emails: tell the user drafts await their approval on the customer page.
- Keep answers concise. Reference customers by name and orders by number (e.g. #5012). Use short markdown bullet lists.
- Currency is USD unless the data says otherwise.`;

/**
 * Tool-using agent loop: the model plans, calls CRM tools, observes results and repeats
 * (max 6 steps) before answering. Every tool call is returned so the UI can show its work.
 */
export async function runCopilot(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  ctx: ToolContext & { customerId?: string },
): Promise<{ answer: string; steps: CopilotStep[] }> {
  if (!llmEnabled()) {
    return {
      answer:
        'The copilot needs an LLM. Set `LLM_API_KEY` (a free Groq key works) and restart the server. ' +
        'Summaries and drafts still work in rules mode on the customer page.',
      steps: [],
    };
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: COPILOT_SYSTEM + (ctx.customerId ? `\nThe user is viewing customer id ${ctx.customerId}.` : '') },
    ...history.slice(-8),
    { role: 'user', content: message },
  ];
  const steps: CopilotStep[] = [];

  for (let i = 0; i < 6; i++) {
    const reply = await chat(messages, { tools: TOOL_DEFINITIONS, temperature: 0.1 });
    messages.push(reply);
    if (!('tool_calls' in reply) || !reply.tool_calls?.length) {
      return { answer: reply.content ?? '', steps };
    }
    for (const call of reply.tool_calls) {
      const { result, mutates } = await runTool(call.function.name, call.function.arguments, ctx);
      const serialized = JSON.stringify(result);
      steps.push({
        tool: call.function.name,
        args: safeParse(call.function.arguments),
        mutates,
        resultPreview: serialized.length > 300 ? `${serialized.slice(0, 300)}…` : serialized,
      });
      messages.push({ role: 'tool', tool_call_id: call.id, content: serialized.slice(0, 12_000) });
    }
  }
  return { answer: 'I needed more steps than allowed to finish this. Try a more specific request.', steps };
}

const safeParse = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};

export const COPILOT_TOOL_NAMES = Object.keys(CRM_TOOLS);
