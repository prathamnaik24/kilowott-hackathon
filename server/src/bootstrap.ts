import bcrypt from 'bcryptjs';
import { env } from './config/env.js';
import { prisma } from './lib/db.js';
import { DEFAULT_WORKFLOWS } from './modules/workflows/default-workflows.js';

/** Idempotent first-boot setup: demo users and default workflows. Safe to run on every start. */
export async function bootstrap() {
  const users = [
    { email: env.ADMIN_EMAIL, name: 'Store Admin', role: 'ADMIN', password: env.ADMIN_PASSWORD },
    { email: 'agent@woopulse.dev', name: 'Support Agent', role: 'AGENT', password: env.ADMIN_PASSWORD },
  ];
  for (const u of users) {
    const exists = await prisma.user.findUnique({ where: { email: u.email } });
    if (!exists) {
      await prisma.user.create({
        data: { email: u.email, name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.password, 10) },
      });
    }
  }

  for (const wf of DEFAULT_WORKFLOWS) {
    await prisma.workflow.upsert({
      where: { key: wf.key },
      update: {},
      create: {
        key: wf.key,
        name: wf.name,
        description: wf.description,
        trigger: wf.trigger,
        conditions: JSON.stringify(wf.conditions),
        actions: JSON.stringify(wf.actions),
      },
    });
  }
}
