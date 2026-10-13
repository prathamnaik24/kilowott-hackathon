import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Regression for AUD-001: values in the .env file must reach the parsed config. */
function configIn(childEnv: Record<string, string | undefined>, fileContents: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'woopulse-env-'));
  const file = path.join(dir, '.env');
  writeFileSync(file, fileContents);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...childEnv, ENV_FILE: file })) if (v !== undefined) env[k] = v;
  delete env.JWT_SECRET;
  delete env.LLM_API_KEY;
  if (childEnv.JWT_SECRET) env.JWT_SECRET = childEnv.JWT_SECRET;
  const out = execFileSync(
    process.execPath,
    ['--import', 'tsx', '-e', "import('./src/config/env.ts').then((m) => console.log(JSON.stringify(m.env)))"],
    { cwd: path.resolve(__dirname, '../..'), env, encoding: 'utf8' },
  );
  return JSON.parse(out.trim().split('\n').pop()!);
}

// Each case spawns a fresh Node process (cold tsx start), so allow more than the 5s default.
describe('env loading (AUD-001)', { timeout: 60_000 }, () => {
  it('applies values from the .env file', () => {
    const cfg = configIn({}, 'JWT_SECRET=from-file-secret-123\nLLM_API_KEY=gsk_from_file\n');
    expect(cfg.JWT_SECRET).toBe('from-file-secret-123');
    expect(cfg.LLM_API_KEY).toBe('gsk_from_file');
  });

  it('lets real environment variables override the file', () => {
    const cfg = configIn({ JWT_SECRET: 'from-process-env-456' }, 'JWT_SECRET=from-file-secret-123\n');
    expect(cfg.JWT_SECRET).toBe('from-process-env-456');
  });
});
