import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: Buffer;
}

const LOCK_KEY = 74_201_601; // arbitrary constant for pg_advisory_lock

export function readMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const sql = readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n');
      return {
        version: Number(f.slice(0, 4)),
        name: f,
        sql,
        checksum: createHash('sha256').update(sql).digest(),
      };
    });
}

/** Applies pending migrations, each in its own transaction. Fails if an applied file was edited. */
export async function migrate(client: pg.Client, dir: string, log: (m: string) => void = console.log) {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum bytea NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map<number, Buffer>(
      (await client.query('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]),
    );
    for (const m of readMigrations(dir)) {
      const known = applied.get(m.version);
      if (known) {
        if (!known.equals(m.checksum)) throw new Error(`Migration ${m.name} was modified after it was applied`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
          m.version,
          m.name,
          m.checksum,
        ]);
        await client.query('COMMIT');
        log(`applied ${m.name}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.name} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}

/**
 * Records migrations up to `version` as applied without running them — for a database where the SQL
 * was executed by hand (e.g. in the Supabase SQL editor). `verify` must confirm the objects exist.
 */
export async function baseline(client: pg.Client, dir: string, version: number, verify: (c: pg.Client) => Promise<string[]>) {
  const missing = await verify(client);
  if (missing.length) throw new Error(`Baseline refused, objects missing: ${missing.join(', ')}`);
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY, name text NOT NULL, checksum bytea NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const m of readMigrations(dir).filter((x) => x.version <= version)) {
    await client.query(
      'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING',
      [m.version, m.name, m.checksum],
    );
  }
}

/** Returns names of migration files that are not applied yet. */
export async function pendingMigrations(db: pg.Pool | pg.Client, dir: string): Promise<string[]> {
  const exists = await db.query(`SELECT to_regclass('schema_migrations') AS t`);
  const applied = new Set<number>(
    exists.rows[0].t ? (await db.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version) : [],
  );
  return readMigrations(dir)
    .filter((m) => !applied.has(m.version))
    .map((m) => m.name);
}
