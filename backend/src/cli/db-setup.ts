/**
 * Creates the `fightscore` role and databases using psql as a superuser.
 * Generates backend/.env with random role and demo-user passwords on first run.
 * psql asks for the superuser password interactively; it is never stored.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const envFile = '.env';

function ensureEnv(): string {
  if (!existsSync(envFile)) {
    const example = readFileSync('.env.example', 'utf8');
    const password = randomBytes(18).toString('base64url');
    const demoPassword = randomBytes(12).toString('base64url');
    // The example leaves DEMO_PASSWORD empty so no password published in the repository is ever used.
    const env = example.replaceAll('CHANGE_ME', password).replace(/^DEMO_PASSWORD=(?=\r?$)/m, `DEMO_PASSWORD=${demoPassword}`);
    writeFileSync(envFile, env);
    console.log('Created backend/.env with generated database and demo-user passwords.');
  }
  process.loadEnvFile(envFile);
  const url = new URL(process.env.DATABASE_URL ?? '');
  return decodeURIComponent(url.password);
}

function findPsql(): string {
  const candidates = [process.env.PSQL, 'C:/Program Files/PostgreSQL/18/bin/psql.exe', 'C:/Program Files/PostgreSQL/17/bin/psql.exe'];
  return candidates.find((c) => c && existsSync(c)) ?? 'psql';
}

const password = ensureEnv();
const superuser = process.env.PG_SUPERUSER ?? 'postgres';
const psql = findPsql();
console.log(`Running ${psql} as "${superuser}". Enter the PostgreSQL superuser password when asked.`);
const res = spawnSync(psql, ['-h', '127.0.0.1', '-U', superuser, '-d', 'postgres', '-f', 'scripts/db-setup.sql'], {
  stdio: 'inherit',
  env: { ...process.env, FIGHTSCORE_DB_PASSWORD: password },
});
process.exit(res.status ?? 1);
