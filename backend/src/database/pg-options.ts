import { readFileSync } from 'node:fs';
import type { ClientConfig } from 'pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

interface SslSettings {
  DATABASE_SSL?: 'disable' | 'require' | 'verify-full';
  DATABASE_SSL_CA?: string;
}

/**
 * Connection options shared by the app and CLI scripts. `sslmode` in the URL is ignored so that
 * DATABASE_SSL is the single source of truth (pg would otherwise let the URL override `ssl`).
 */
export function pgOptions(connectionString: string, settings: SslSettings = {}): ClientConfig {
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  const mode = settings.DATABASE_SSL ?? (LOCAL_HOSTS.has(url.hostname) ? 'disable' : 'require');
  if (mode === 'disable') return { connectionString: url.toString() };
  if (mode === 'require') return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
  if (!settings.DATABASE_SSL_CA) throw new Error('DATABASE_SSL=verify-full requires DATABASE_SSL_CA (path to the CA certificate)');
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true, ca: readFileSync(settings.DATABASE_SSL_CA, 'utf8') } };
}
