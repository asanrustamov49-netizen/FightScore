import { existsSync } from 'node:fs';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DEPLOY_MODE: z.enum(['dev-http', 'production']).default('dev-http'),
  DEPLOY_TARGET: z.enum(['local', 'cloud']).default('local'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url(),
  // TLS to PostgreSQL. Default: disable for localhost, require (encrypted) for remote hosts such as Supabase.
  // verify-full also checks the server certificate against DATABASE_SSL_CA (e.g. the Supabase CA file).
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).optional(),
  DATABASE_SSL_CA: z.string().optional(),
  // Comma-separated list of browser origins allowed to call the API and open sockets.
  PUBLIC_ORIGINS: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  // Self-service organizer sign-up. Unset: on in dev-http, off in production (an admin creates accounts).
  ALLOW_REGISTRATION: z.enum(['true', 'false']).optional(),
});

export type AppConfig = z.infer<typeof schema> & { publicOrigins: string[]; allowRegistration: boolean };

let cached: AppConfig | undefined;

/** Loads `.env` from the working directory (if present) and validates the environment. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached && env === process.env) return cached;
  if (env === process.env && existsSync('.env')) process.loadEnvFile('.env');
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${issues.join('\n  ')}`);
  }
  const config = {
    ...parsed.data,
    publicOrigins: parsed.data.PUBLIC_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    allowRegistration: parsed.data.ALLOW_REGISTRATION ? parsed.data.ALLOW_REGISTRATION === 'true' : parsed.data.DEPLOY_MODE === 'dev-http',
  };
  if (config.DEPLOY_MODE === 'production' && config.publicOrigins.some((o) => !o.startsWith('https://'))) {
    throw new Error('DEPLOY_MODE=production requires https:// PUBLIC_ORIGINS (see docs/ARCHITECTURE.md §9.1)');
  }
  if (env === process.env) cached = config;
  return config;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
