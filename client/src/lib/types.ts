export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'AGENT';
}

export interface LineItem {
  name: string;
  quantity: number;
  total: number;
}

export interface CustomerMetrics {
  ordersCount: number;
  totalSpent: number;
  averageOrderValue: number;
  cancelledCount: number;
  refundedCount: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
}

export interface CustomerRow extends CustomerMetrics {
  id: string;
  wooCustomerId: number | null;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  city: string | null;
  country: string | null;
  isGuest: boolean;
  tags: string[];
}

export interface Order {
  id: string;
  wooOrderId: number;
  number: string;
  customerId: string;
  status: string;
  currency: string;
  total: number;
  paymentMethod: string | null;
  lineItems: LineItem[];
  wooCreatedAt: string;
  wooModifiedAt: string;
  syncedAt: string;
  customer?: { id: string; firstName: string; lastName: string; email?: string; isGuest?: boolean };
}

export interface Customer360 extends Omit<CustomerRow, keyof CustomerMetrics> {
  metrics: CustomerMetrics;
  orders: Order[];
}

export interface TimelineItem {
  id: string;
  kind: 'ORDER_PLACED' | 'STATUS_CHANGE' | 'NOTE' | 'TASK' | 'EMAIL' | 'AI_SUMMARY' | 'WORKFLOW';
  at: string;
  title: string;
  body?: string;
  status?: string | null;
  origin?: string;
  orderNumber?: string;
  activityId?: string;
  dueAt?: string | null;
}

export type Severity = 'low' | 'medium' | 'high';

export interface RiskFlag {
  code: string;
  severity: Severity;
  reason: string;
  suggestedAction: string;
}

export interface AtRiskOrder {
  orderId: string;
  number: string;
  status: string;
  total: number;
  currency: string;
  customer: { id: string; name: string; email: string };
  severity: Severity;
  flags: RiskFlag[];
}

export interface WorkflowRun {
  id: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  output: Array<{ type: string; ok: boolean; detail: string }>;
  error: string | null;
  createdAt: string;
  workflow: { name: string; key?: string };
  customer: { id?: string; firstName: string; lastName: string } | null;
  order?: { id: string; number: string } | null;
}

export interface Workflow {
  id: string;
  key: string;
  name: string;
  description: string;
  trigger: string;
  conditions: Array<{ field: string; op: string; value: unknown }>;
  actions: Array<{ type: string; [k: string]: unknown }>;
  isActive: boolean;
  runCount: number;
}

export interface CustomerInsight {
  summary: string;
  purchaseBehavior: string;
  risks: string[];
  nextBestAction: string;
  sources: string[];
  generatedBy: 'llm' | 'rules';
}

export interface CopilotStep {
  tool: string;
  args: unknown;
  mutates: boolean;
  resultPreview: string;
}
