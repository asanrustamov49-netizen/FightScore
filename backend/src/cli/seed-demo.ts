/**
 * Demo data for local development and presentations. Refuses to run with NODE_ENV=production.
 * Everything it creates is labelled as demonstration data; the rule profile is NOT a sports regulation.
 * Demo users get the password from DEMO_PASSWORD in backend/.env.
 */
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../config/config.js';
import { pgOptions } from '../database/pg-options.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../common/password.js';
import { definitionSchema } from '../modules/rules/definition.js';

const config = loadConfig();
if (config.NODE_ENV === 'production') {
  console.error('seed:demo is disabled for NODE_ENV=production');
  process.exit(1);
}
const password = process.env.DEMO_PASSWORD ?? '';
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Set DEMO_PASSWORD (at least ${MIN_PASSWORD_LENGTH} characters) in backend/.env first.`);
  process.exit(1);
}

const TOURNAMENT = 'Демо-турнир FightScore';

// Arbitrary demonstration values. Not taken from any federation regulation (PROJECT_SPEC §10).
const demoDefinition = definitionSchema.parse({
  periods: { count: 3, durationSec: 180 },
  scoring: [
    { code: 'p1', label: '+1', points: 1 },
    { code: 'p2', label: '+2', points: 2 },
    { code: 'p3', label: '+3', points: 3 },
  ],
  penalties: [
    { code: 'warning', label: 'Предупреждение', public: true, opponentPoints: 0 },
    { code: 'penalty', label: 'Штраф (+1 сопернику)', public: true, opponentPoints: 1 },
  ],
  endMethods: [
    { code: 'points', label: 'Победа по очкам', requiresWinner: true },
    { code: 'early', label: 'Досрочная победа', requiresWinner: true },
    { code: 'dq', label: 'Дисквалификация соперника', requiresWinner: true },
    { code: 'draw', label: 'Ничья', requiresWinner: false },
  ],
  roles: {
    chief_judge: ['score', 'penalty', 'timer', 'period', 'correct', 'end', 'confirm'],
    judge: ['score', 'penalty'],
  },
  timeAdjust: { maxSec: 60 },
});

const ATHLETES: [string, string, string, number, string][] = [
  ['Арсен', 'Галстян', 'AM', 1998, 'Ереван Файт'],
  ['Мурад', 'Алиев', 'AZ', 2000, 'Баку Атлет'],
  ['Иван', 'Петров', 'RU', 1997, 'Сибирский Медведь'],
  ['Даниэл', 'Сантус', 'BR', 1996, 'Рио Тим'],
  ['Нурлан', 'Ахметов', 'KZ', 1999, 'Алматы Барыс'],
  ['Гиорги', 'Беридзе', 'GE', 2001, 'Тбилиси Лев'],
  ['Тимур', 'Каримов', 'UZ', 1998, 'Ташкент Кураш'],
  ['Лукас', 'Мюллер', 'DE', 1995, 'Берлин Кампф'],
];

const client = new pg.Client(pgOptions(config.DATABASE_URL, config));
await client.connect();
try {
  const existing = await client.query(`SELECT id FROM tournaments WHERE name = $1`, [TOURNAMENT]);
  if (existing.rowCount) {
    console.log('Demo data already present; nothing to do.');
    process.exit(0);
  }
  await client.query('BEGIN');
  const hash = await hashPassword(password);
  const users: Record<string, string> = {};
  for (const [login, name, role] of [
    ['demo.organizer', 'Организатор (демо)', 'organizer'],
    ['demo.chief', 'Главный судья (демо)', 'chief_judge'],
    ['demo.judge', 'Боковой судья (демо)', 'judge'],
  ]) {
    const u = await client.query(
      `INSERT INTO users (login, display_name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (lower(login)) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
      [login, name, hash],
    );
    users[login] = u.rows[0].id;
    await client.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type) SELECT $1, id, 'system' FROM roles WHERE code = $2
       ON CONFLICT DO NOTHING`,
      [u.rows[0].id, role],
    );
  }
  const organizer = users['demo.organizer'];

  const mma = (await client.query(`SELECT id FROM disciplines WHERE code = 'mma'`)).rows[0].id;
  const profile = await client.query(
    `INSERT INTO rule_profiles (discipline_id, code, name, created_by) VALUES ($1, 'demo-points', $2, $3)
     ON CONFLICT (discipline_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [mma, 'ДЕМО: очковый профиль (не официальный регламент)', organizer],
  );
  const json = JSON.stringify(demoDefinition);
  const version = await client.query(
    `INSERT INTO rule_profile_versions (rule_profile_id, version_number, status, is_demo, engine, engine_version, definition,
       definition_sha256, effective_from, change_summary, created_by, approved_at)
     VALUES ($1, 1, 'approved', true, 'generic-points', 1, $2, $3, current_date,
       'Демонстрационные значения для показа интерфейса. Не основаны на регламенте федерации.', $4, now())
     ON CONFLICT (rule_profile_id, version_number) DO UPDATE SET status = rule_profile_versions.status RETURNING id`,
    [profile.rows[0].id, json, createHash('sha256').update(json).digest(), organizer],
  );
  const ruleVersionId = version.rows[0].id;

  const today = new Date().toISOString().slice(0, 10);
  const t = await client.query(
    `INSERT INTO tournaments (name, starts_on, ends_on, venue, status, created_by) VALUES ($1, $2, $2, $3, 'active', $4) RETURNING id`,
    [TOURNAMENT, today, 'Демо-зал, татами 1', organizer],
  );
  const tournamentId = t.rows[0].id;
  await client.query(`INSERT INTO tournament_disciplines (tournament_id, discipline_id) VALUES ($1, $2)`, [tournamentId, mma]);

  const entries: string[] = [];
  for (const [i, [first, last, country, year, club]] of ATHLETES.entries()) {
    const c = (await client.query(`SELECT id FROM countries WHERE iso_alpha2 = $1`, [country])).rows[0].id;
    const clubRow = await client.query(
      `INSERT INTO clubs (name, country_id) VALUES ($1, $2)
       ON CONFLICT (lower(name), country_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [club, c],
    );
    const a = await client.query(
      `INSERT INTO athletes (first_name, last_name, birth_year, country_id, club_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [first, last, year, c, clubRow.rows[0].id],
    );
    const e = await client.query(
      `INSERT INTO tournament_athletes (tournament_id, athlete_id, registration_number) VALUES ($1, $2, $3) RETURNING id`,
      [tournamentId, a.rows[0].id, `D-${String(i + 1).padStart(3, '0')}`],
    );
    entries.push(e.rows[0].id);
  }

  const matchIds: string[] = [];
  for (let n = 1; n <= 4; n++) {
    const m = await client.query(
      `INSERT INTO matches (tournament_id, discipline_id, rule_profile_version_id, match_number, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tournamentId, mma, ruleVersionId, n, organizer],
    );
    const id = m.rows[0].id;
    matchIds.push(id);
    await client.query(`INSERT INTO match_states (match_id, score, penalties) VALUES ($1, '{"red":0,"blue":0}', '{"red":{},"blue":{}}')`, [id]);
    await client.query(
      `INSERT INTO match_participants (match_id, side, tournament_athlete_id) VALUES ($1, 'red', $2), ($1, 'blue', $3)`,
      [id, entries[(n - 1) * 2], entries[(n - 1) * 2 + 1]],
    );
    await client.query(
      `INSERT INTO match_officials (match_id, user_id, official_role, assigned_by) VALUES ($1, $2, 'chief_judge', $4), ($1, $3, 'judge', $4)`,
      [id, users['demo.chief'], users['demo.judge'], organizer],
    );
  }
  // Match 1 goes through the regular event pipeline state: ready to start.
  await client.query(`UPDATE matches SET status = 'ready' WHERE id = $1`, [matchIds[0]]);
  await client.query(`UPDATE match_states SET version = 1 WHERE match_id = $1`, [matchIds[0]]);
  await client.query(
    `INSERT INTO match_events (match_id, seq, command_id, type, payload, actor_user_id, actor_role)
     VALUES ($1, 1, gen_random_uuid(), 'match.ready', '{"type":"match.ready"}', $2, 'organizer')`,
    [matchIds[0], organizer],
  );

  await client.query(
    `INSERT INTO displays (tournament_id, name, public_token, current_match_id, created_by) VALUES ($1, 'Татами 1 — ТВ', $2, $3, $4)`,
    [tournamentId, randomBytes(24).toString('base64url'), matchIds[0], organizer],
  );
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, tournament_id, data)
     VALUES (NULL, 'demo.seed', 'tournament', $1, $1, '{"note":"demonstration data"}')`,
    [tournamentId],
  );
  await client.query('COMMIT');
  console.log('Demo data created: users demo.organizer, demo.chief, demo.judge (password = DEMO_PASSWORD).');
} catch (err) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
