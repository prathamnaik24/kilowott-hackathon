import type { Condition, WorkflowAction, WorkflowTrigger } from './workflow.types.js';

export interface WorkflowDefinition {
  key: string;
  name: string;
  description: string;
  trigger: WorkflowTrigger;
  conditions: Condition[];
  actions: WorkflowAction[];
}

/** Workflows seeded on first boot. Users can toggle them on/off from the UI. */
export const DEFAULT_WORKFLOWS: WorkflowDefinition[] = [
  {
    key: 'on-hold-apology',
    name: 'Order on hold → apology + support task',
    description: 'When an order moves to on-hold, apologise to the customer and open a support task.',
    trigger: 'ORDER_STATUS_CHANGED',
    conditions: [{ field: 'order.newStatus', op: 'eq', value: 'on-hold' }],
    actions: [
      {
        type: 'SEND_EMAIL',
        subject: 'An update on your order #{{order.number}}',
        body:
          'Hi {{customer.firstName}},\n\nYour order #{{order.number}} is temporarily on hold. ' +
          'Our team is looking into it and will update you within 24 hours.\n\nSorry for the wait,\nThe Store Team',
      },
      {
        type: 'CREATE_TASK',
        title: 'Resolve on-hold order #{{order.number}}',
        body: 'Investigate why the order is on hold and contact {{customer.firstName}}.',
        dueInHours: 24,
      },
    ],
  },
  {
    key: 'completed-review-request',
    name: 'Order completed → review request',
    description: 'Ask happy customers for a review once their order is completed.',
    trigger: 'ORDER_STATUS_CHANGED',
    conditions: [{ field: 'order.newStatus', op: 'eq', value: 'completed' }],
    actions: [
      {
        type: 'SEND_EMAIL',
        subject: 'How was your order #{{order.number}}?',
        body:
          'Hi {{customer.firstName}},\n\nYour order #{{order.number}} has been delivered. ' +
          'We would love to hear what you think — leaving a quick review helps us a lot!\n\nThank you,\nThe Store Team',
      },
    ],
  },
  {
    key: 'vip-order',
    name: 'High-value order → VIP follow-up',
    description: 'Orders of 200 or more get a personal thank-you task and a VIP tag.',
    trigger: 'ORDER_CREATED',
    conditions: [{ field: 'order.total', op: 'gte', value: 200 }],
    actions: [
      {
        type: 'CREATE_TASK',
        title: 'Personally thank VIP for order #{{order.number}}',
        body: '{{customer.firstName}} placed a {{order.currency}} {{order.total}} order. Send a personal note.',
        dueInHours: 4,
      },
      { type: 'ADD_TAG', tag: 'vip' },
    ],
  },
  {
    key: 'cancelled-retention',
    name: 'Order cancelled → retention task',
    description: 'Open a retention task when a customer cancels an order.',
    trigger: 'ORDER_STATUS_CHANGED',
    conditions: [{ field: 'order.newStatus', op: 'eq', value: 'cancelled' }],
    actions: [
      {
        type: 'CREATE_TASK',
        title: 'Win back {{customer.firstName}} (cancelled #{{order.number}})',
        body: 'Reach out to understand the cancellation reason and offer help.',
        dueInHours: 48,
      },
      { type: 'ADD_TAG', tag: 'churn-risk' },
    ],
  },
  {
    key: 'welcome-new-customer',
    name: 'New customer → welcome email',
    description: 'Send a welcome email when a new customer account is created.',
    trigger: 'CUSTOMER_CREATED',
    conditions: [],
    actions: [
      {
        type: 'SEND_EMAIL',
        subject: 'Welcome, {{customer.firstName}}!',
        body: 'Hi {{customer.firstName}},\n\nThanks for creating an account with us. Reply any time if you need help.\n\nThe Store Team',
      },
    ],
  },
];
