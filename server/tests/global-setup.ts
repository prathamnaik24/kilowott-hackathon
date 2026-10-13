import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

/** Creates a fresh, throwaway SQLite database (prisma/test.db) for the integration tests. */
export default function setup() {
  for (const suffix of ['', '-journal']) {
    rmSync(path.resolve('prisma', `test.db${suffix}`), { force: true });
  }
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'ignore',
  });
}
