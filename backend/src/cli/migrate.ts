import pg from 'pg';
import { loadConfig } from '../config/config.js';
import { pgOptions } from '../database/pg-options.js';
import { baseline, migrate } from '../database/migrator.js';

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
  await migrate(client, 'migrations');
  console.log('Migrations are up to date.');
} finally {
  await client.end();
}
