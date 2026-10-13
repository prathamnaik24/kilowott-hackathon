import { describe, expect, it } from 'vitest';
import { evaluateCondition, evaluateConditions } from '../../src/modules/workflows/conditions.js';
import type { WorkflowContext } from '../../src/modules/workflows/workflow.types.js';
import { renderTemplate } from '../../src/lib/template.js';

const ctx: WorkflowContext = {
  customer: { id: 'c1', firstName: 'Priya', lastName: 'Sharma', email: 'p@x.com', ordersCount: 4, totalSpent: 820, tags: ['vip'] },
  order: { id: 'o1', number: '5012', status: 'on-hold', previousStatus: 'processing', newStatus: 'on-hold', total: 249.5, currency: 'USD' },
};

describe('workflow conditions', () => {
  it.each([
    [{ field: 'order.newStatus', op: 'eq', value: 'on-hold' }, true],
    [{ field: 'order.newStatus', op: 'neq', value: 'on-hold' }, false],
    [{ field: 'order.total', op: 'gte', value: 200 }, true],
    [{ field: 'order.total', op: 'lt', value: 200 }, false],
    [{ field: 'order.previousStatus', op: 'in', value: ['processing', 'pending'] }, true],
    [{ field: 'customer.tags', op: 'contains', value: 'vip' }, true],
    [{ field: 'customer.ordersCount', op: 'gt', value: 10 }, false],
    [{ field: 'order.missing', op: 'gt', value: 0 }, false],
  ] as const)('%j → %s', (condition, expected) => {
    expect(evaluateCondition(condition as never, ctx)).toBe(expected);
  });

  it('combines conditions with AND and matches an empty list', () => {
    expect(evaluateConditions([], ctx)).toBe(true);
    expect(
      evaluateConditions(
        [
          { field: 'order.newStatus', op: 'eq', value: 'on-hold' },
          { field: 'order.total', op: 'gte', value: 1000 },
        ],
        ctx,
      ),
    ).toBe(false);
  });
});

describe('renderTemplate', () => {
  it('fills nested variables and blanks unknown ones', () => {
    expect(renderTemplate('Hi {{customer.firstName}}, order #{{ order.number }} {{order.nope}}!', ctx as never)).toBe(
      'Hi Priya, order #5012 !',
    );
  });
});
