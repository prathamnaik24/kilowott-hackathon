import { z } from 'zod';

export const WORKFLOW_TRIGGERS = ['ORDER_CREATED', 'ORDER_STATUS_CHANGED', 'CUSTOMER_CREATED'] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export const ConditionSchema = z.object({
  /** Dot path into the workflow context, e.g. "order.total" or "order.newStatus". */
  field: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
});
export type Condition = z.infer<typeof ConditionSchema>;

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CREATE_TASK'),
    title: z.string(),
    body: z.string().default(''),
    dueInHours: z.number().default(24),
  }),
  z.object({
    type: z.literal('SEND_EMAIL'),
    subject: z.string(),
    body: z.string(),
  }),
  z.object({
    type: z.literal('ADD_TAG'),
    tag: z.string(),
  }),
]);
export type WorkflowAction = z.infer<typeof ActionSchema>;

/** The data a workflow can read, assembled from the triggering event. */
export interface WorkflowContext {
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    ordersCount: number;
    totalSpent: number;
    tags: string[];
  };
  order?: {
    id: string;
    number: string;
    status: string;
    previousStatus: string | null;
    newStatus: string;
    total: number;
    currency: string;
  };
}

export interface ActionResult {
  type: WorkflowAction['type'];
  ok: boolean;
  detail: string;
}
