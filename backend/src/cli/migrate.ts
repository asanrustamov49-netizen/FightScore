import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../config/config.js';
import { pgOptions } from '../database/pg-options.js';
import { baseline, migrate, pendingMigrations } from '../database/migrator.js';

// Objects created by 0001_init.sql; checked before marking it applied with --baseline=1.
const INIT_TABLES = [
  'users', 'sessions', 'roles', 'role_permissions', 'audit_log', 'countries', 'clubs', 'disciplines', 'athletes',
  'tournaments', 'user_role_assignments', 'tournament_disciplines', 'tournament_athletes', 'rule_profiles',
  'rule_profile_versions', 'matches', 'match_participants', 'match_officials', 'match_states', 'match_events',
  'match_results', 'displays',
];
const INIT_TRIGGERS = [
  'audit_log_append_only', 'match_events_append_only', 'match_results_append_only', 'rule_profile_versions_guard', 'matches_setup_guard',
];

const config = loadConfig();
const url = process.argv.includes('--test') ? process.env.TEST_DATABASE_URL : config.DATABASE_URL;
const baselineArg = process.argv.find((a) => a.startsWith('--baseline='));
const client = new pg.Client(pgOptions(url as string, config));
await client.connect();
try {
  if (baselineArg) {
    const version = Number(baselineArg.split('=')[1]);
    if (version !== 1) throw new Error('Only --baseline=1 (0001_init.sql) is supported');
    await baseline(client, 'migrations', version, async (c) => {
      const tables = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).rows.map((r) => r.tablename);
      const triggers = (await c.query(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)).rows.map((r) => r.tgname);
      return [...INIT_TABLES.filter((t) => !tables.includes(t)), ...INIT_TRIGGERS.filter((t) => !triggers.includes(t))];
    });
    console.log('0001_init.sql recorded as applied.');
  }
  // A schema change on a database with data is preceded by a backup (docs/ARCHITECTURE.md §9). A fresh database
  // (no schema_migrations yet) and the test database have nothing to lose. FS_SKIP_BACKUP=1 skips it deliberately.
  const hasData = (await client.query(`SELECT to_regclass('schema_migrations') AS t`)).rows[0].t !== null;
  const pending = await pendingMigrations(client, 'migrations');
  if (pending.length && hasData && !process.argv.includes('--test') && process.env.FS_SKIP_BACKUP !== '1') {
    console.log(`Перед миграциями (${pending.join(', ')}) — резервная копия базы.`);
    const backup = fileURLToPath(new URL('./backup.js', import.meta.url));
    const r = spawnSync(process.execPath, [backup, 'backup'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
    if (r.status !== 0) {
      throw new Error('Резервная копия не создана, миграции не применены. Исправьте причину выше или запустите с FS_SKIP_BACKUP=1, если копия не нужна.');
    }
  }
  await migrate(client, 'migrations');
  console.log('Migrations are up to date.');
} finally {
  await client.end();
}
