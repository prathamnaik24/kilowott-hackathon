import type { Condition, WorkflowContext } from './workflow.types.js';

export function getPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

export function evaluateCondition(condition: Condition, context: WorkflowContext): boolean {
  const actual = getPath(context, condition.field);
  const expected = condition.value;

  switch (condition.op) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gt':
      return typeof actual === 'number' && actual > Number(expected);
    case 'gte':
      return typeof actual === 'number' && actual >= Number(expected);
    case 'lt':
      return typeof actual === 'number' && actual < Number(expected);
    case 'lte':
      return typeof actual === 'number' && actual <= Number(expected);
    case 'in':
      return Array.isArray(expected) && (expected as unknown[]).includes(actual);
    case 'contains':
      return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? '').includes(String(expected));
  }
}

/** All conditions must hold (AND). An empty list always matches. */
export function evaluateConditions(conditions: Condition[], context: WorkflowContext): boolean {
  return conditions.every((c) => evaluateCondition(c, context));
}
