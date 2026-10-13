import { prisma } from '../../lib/db.js';

export interface OutgoingEmail {
  customerId: string;
  orderId?: string | null;
  subject: string;
  body: string;
  origin: string;
  createdById?: string | null;
}

/**
 * Email delivery. The demo uses a "log" transport: every email is recorded on the customer
 * timeline as a SENT activity and printed to the server log. Plug an SMTP/Resend transport
 * into `deliver` for production.
 */
export async function sendEmail(email: OutgoingEmail) {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: email.customerId } });
  await deliver(customer.email, email.subject, email.body);
  return prisma.activity.create({
    data: {
      customerId: email.customerId,
      orderId: email.orderId ?? null,
      type: 'EMAIL',
      status: 'SENT',
      title: email.subject,
      body: email.body,
      origin: email.origin,
      createdById: email.createdById ?? null,
    },
  });
}

/** Marks an existing draft as approved and delivers it (human-in-the-loop for AI drafts). */
export async function sendDraft(activityId: string, approvedById: string, edits?: { subject?: string; body?: string }) {
  const draft = await prisma.activity.findUniqueOrThrow({ where: { id: activityId }, include: { customer: true } });
  if (draft.type !== 'EMAIL' || draft.status !== 'DRAFT') throw new Error('Activity is not an email draft');
  const subject = edits?.subject ?? draft.title;
  const body = edits?.body ?? draft.body;
  await deliver(draft.customer.email, subject, body);
  return prisma.activity.update({
    where: { id: activityId },
    data: { status: 'SENT', title: subject, body, createdById: approvedById },
  });
}

async function deliver(to: string, subject: string, _body: string) {
  if (process.env.NODE_ENV !== 'test') console.log(`[email] → ${to}: ${subject}`);
}
