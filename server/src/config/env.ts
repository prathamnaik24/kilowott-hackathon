import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default('file:./dev.db'),
  JWT_SECRET: z.string().min(8).default('dev-only-change-me'),
  /** Public base URL of this server (used by the mock store to deliver webhooks). */
  PUBLIC_URL: z.string().default('http://localhost:4000'),

  WOO_STORE_URL: z.string().default(''),
  WOO_CONSUMER_KEY: z.string().default('ck_mock'),
  WOO_CONSUMER_SECRET: z.string().default('cs_mock'),
  WOO_WEBHOOK_SECRET: z.string().default('woopulse-webhook-secret'),

  /** Mount a WooCommerce-compatible mock store at /mock-woo (demo + tests). */
  MOCK_WOO_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  AUTO_SYNC_ON_BOOT: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  /** Any OpenAI-compatible endpoint: Groq (default), OpenAI, Ollama, ... */
  LLM_BASE_URL: z.string().default('https://api.groq.com/openai/v1'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('llama-3.3-70b-versatile'),

  ADMIN_EMAIL: z.string().default('admin@woopulse.dev'),
  ADMIN_PASSWORD: z.string().default('demo1234'),
});

export const env = EnvSchema.parse(process.env);

/** The store URL: explicit config, or the built-in mock store served by this same process. */
export function wooStoreUrl(): string {
  return env.WOO_STORE_URL || `http://127.0.0.1:${env.PORT}/mock-woo`;
}
