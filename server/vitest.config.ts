import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      DATABASE_URL: 'file:./test.db',
      JWT_SECRET: 'test-secret',
      WOO_WEBHOOK_SECRET: 'test-webhook-secret',
      LLM_API_KEY: '',
      MOCK_WOO_ENABLED: 'false',
      AUTO_SYNC_ON_BOOT: 'false',
    },
    fileParallelism: false,
    globalSetup: ['tests/global-setup.ts'],
  },
});
