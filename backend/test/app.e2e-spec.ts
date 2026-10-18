/**
 * End-to-end scenario against a real PostgreSQL database (TEST_DATABASE_URL, schema is reset).
 * Covers PROJECT_SPEC §17 key scenario: auth, permissions, tournament → match → judging → result,
 * idempotency, version conflicts, concurrent commands, audit/event log, WebSocket sync, restart recovery.
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';

if (existsSync('.env')) process.loadEnvFile('.env');

/**
 * The suite drops and recreates the `public` schema. It runs only against a dedicated local database:
 * the name ends with "_test", the host is loopback, and it is not the DATABASE_URL database.
 * Targets are taken from what `pg` will actually connect to (query parameters such as ?host= included).
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const TEST_NAME = /^[a-z0-9_]+_test$/;

function target(url: string) {
  const c = new pg.Client({ connectionString: url });
  return { host: c.host, port: c.port, database: c.database ?? '' };
}

function safeTestDatabase(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return undefined;
  const t = target(url);
  const main = process.env.DATABASE_URL ? target(process.env.DATABASE_URL) : undefined;
  const reason = !TEST_NAME.test(t.database)
    ? `database "${t.database}" does not end with "_test"`
    : !LOOPBACK.has(t.host)
      ? `host "${t.host}" is not loopback`
      : main && main.database === t.database && main.port === t.port
        ? `it is the DATABASE_URL database`
        : undefined;
  if (reason) {
    console.warn(`e2e skipped: TEST_DATABASE_URL is not a dedicated local test database (${reason}).`);
    return undefined;
  }
  return url;
}

const TEST_DB = safeTestDatabase();
const TEST_DB_NAME = TEST_DB ? target(TEST_DB).database : '';
if (TEST_DB) {
  process.env.DATABASE_URL = TEST_DB;
  process.env.PUBLIC_ORIGINS = 'http://localhost:3000';
}

const PASSWORD = 'e2e-password-123';
const H = { 'X-FightScore-Request': '1' };

async function resetDatabase() {
  const { migrate } = await import('../src/database/migrator.js');
  const { hashPassword } = await import('../src/common/password.js');
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  // The server, not the URL, decides which database we are in (poolers can route elsewhere).
  const actual = (await c.query<{ db: string }>('SELECT current_database() AS db')).rows[0].db;
  if (actual !== TEST_DB_NAME) {
    await c.end();
    throw new Error(`refusing to reset schema: connected to "${actual}", expected "${TEST_DB_NAME}"`);
  }
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(c, 'migrations', () => undefined);
  const hash = await hashPassword(PASSWORD);
  for (const [login, role] of [
    ['org', 'organizer'],
    ['chief', 'chief_judge'],
    ['judge', 'judge'],
    ['other', 'judge'],
  ]) {
    await c.query(
      `WITH u AS (INSERT INTO users (login, display_name, password_hash) VALUES ($1, $1, $2) RETURNING id)
       INSERT INTO user_role_assignments (user_id, role_id, scope_type) SELECT u.id, r.id, 'system' FROM u, roles r WHERE r.code = $3`,
      [login, hash, role],
    );
  }
  const def = {
    periods: { count: 2, durationSec: 2 },
    scoring: [{ code: 'p1', label: '+1', points: 1 }, { code: 'p2', label: '+2', points: 2 }],
    penalties: [{ code: 'w', label: 'W', public: true, opponentPoints: 1 }],
    endMethods: [{ code: 'points', label: 'Очки', requiresWinner: true }],
    roles: { chief_judge: ['score', 'penalty', 'timer', 'period', 'correct', 'end', 'confirm'], judge: ['score'] },
    timeAdjust: { maxSec: 2 },
  };
  const v = await c.query(
    `WITH p AS (INSERT INTO rule_profiles (discipline_id, code, name) SELECT id, 'e2e', 'E2E fixture' FROM disciplines WHERE code = 'mma' RETURNING id)
     INSERT INTO rule_profile_versions (rule_profile_id, version_number, status, is_demo, engine, engine_version, definition, definition_sha256, effective_from, approved_at)
     SELECT p.id, 1, 'approved', true, 'generic-points', 1, $1, '\\x00', current_date, now() FROM p RETURNING id`,
    [def],
  );
  const mma = (await c.query(`SELECT id FROM disciplines WHERE code = 'mma'`)).rows[0].id;
  const ru = (await c.query(`SELECT id FROM countries WHERE iso_alpha2 = 'RU'`)).rows[0].id;
  await c.end();
  return { ruleVersionId: v.rows[0].id as string, mma: mma as string, ru: ru as string };
}

async function startApp(): Promise<{ app: INestApplication; url: string }> {
  const { AppModule } = await import('../src/app.module.js');
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return { app, url: await app.getUrl() };
}

describe.skipIf(!TEST_DB)('FightScore MVP scenario (PostgreSQL)', () => {
  let app: INestApplication;
  let url: string;
  let fx: Awaited<ReturnType<typeof resetDatabase>>;
  const cookies: Record<string, string> = {};
  let tournamentId: string;
  let matchId: string;
  let displayToken: string;
  let version = 0;

  const db = () => new pg.Client({ connectionString: TEST_DB });
  const api = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (p: string) => api().get(`/api${p}`).set('Cookie', cookies[who] ?? ''),
    post: (p: string, body?: object) => api().post(`/api${p}`).set(H).set('Cookie', cookies[who] ?? '').send(body),
    put: (p: string, body?: object) => api().put(`/api${p}`).set(H).set('Cookie', cookies[who] ?? '').send(body),
  });
  const command = (who: string, cmd: object, opts: { commandId?: string; expectedVersion?: number } = {}) =>
    as(who).post(`/matches/${matchId}/commands`, {
      commandId: opts.commandId ?? randomUUID(),
      expectedVersion: opts.expectedVersion ?? version,
      command: cmd,
    });
  const accept = async (who: string, cmd: object) => {
    const res = await command(who, cmd);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    version = res.body.version;
    return res.body;
  };

  beforeAll(async () => {
    fx = await resetDatabase();
    ({ app, url } = await startApp());
    for (const who of ['org', 'chief', 'judge', 'other']) {
      const res = await api().post('/api/auth/login').set(H).send({ login: who, password: PASSWORD });
      expect(res.status).toBe(200);
      cookies[who] = res.headers['set-cookie'][0].split(';')[0];
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('rejects bad credentials, missing session and missing CSRF header', async () => {
    expect((await api().post('/api/auth/login').set(H).send({ login: 'org', password: 'wrong-pass' })).status).toBe(401);
    expect((await api().get('/api/tournaments')).status).toBe(401);
    expect((await api().post('/api/auth/login').send({ login: 'org', password: PASSWORD })).status).toBe(403);
    expect((await api().post('/api/tournaments').set(H).set('Origin', 'http://evil.example').set('Cookie', cookies.org).send({})).status).toBe(403);
  });

  it('self-registration grants only organizer_self; judge accounts come from the tournament organizer', async () => {
    const reg = await api()
      .post('/api/auth/register')
      .set(H)
      .send({ login: 'new.org@example.com', displayName: 'New Org', password: PASSWORD, role: 'owner', roles: ['owner'] });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    expect(reg.body.roles.map((r: any) => r.code ?? r)).toEqual(['organizer_self']);
    expect(reg.body.capabilities).toMatchObject({ organizer: true, judge: false, displays: false });
    const self = reg.headers['set-cookie'][0].split(';')[0];
    const asSelf = (p: string, body: object) => api().post(`/api${p}`).set(H).set('Cookie', self).send(body);

    const dup = await api().post('/api/auth/register').set(H).send({ login: 'NEW.ORG@example.com', displayName: 'X', password: PASSWORD });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/логин уже занят/);
    expect((await asSelf('/users', { login: 'x.owner', displayName: 'X', password: PASSWORD, role: 'organizer' })).status).toBe(403);

    const own = await asSelf('/tournaments', { name: 'Self Cup', startsOn: '2026-10-16', endsOn: '2026-10-16', disciplineIds: [fx.mma] });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    const judge = await asSelf(`/tournaments/${own.body.id}/judges`, { login: 'self.judge', displayName: 'Self Judge', password: PASSWORD, role: 'judge' });
    expect(judge.status, JSON.stringify(judge.body)).toBe(201);
    const login = await api().post('/api/auth/login').set(H).send({ login: 'self.judge', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.capabilities).toMatchObject({ organizer: false, judge: true });

    // Another organizer's tournament: no right to create judges there.
    const foreign = await as('org').post('/tournaments', { name: 'Org Cup', startsOn: '2026-10-16', endsOn: '2026-10-16', disciplineIds: [fx.mma] });
    expect(foreign.status).toBe(201);
    expect((await asSelf(`/tournaments/${foreign.body.id}/judges`, { login: 'x.judge', displayName: 'X', password: PASSWORD, role: 'judge' })).status).toBe(403);
  });

  it('lets the organizer create a tournament, athletes and a match; judges cannot', async () => {
    const t = await as('org').post('/tournaments', { name: 'E2E Cup', startsOn: '2026-10-16', endsOn: '2026-10-17', disciplineIds: [fx.mma] });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    tournamentId = t.body.id;
    expect((await as('judge').post('/tournaments', { name: 'X', startsOn: '2026-10-16', endsOn: '2026-10-16', disciplineIds: [fx.mma] })).status).toBe(403);

    const entries: string[] = [];
    for (const last of ['Красный', 'Синий']) {
      const a = await as('org').post('/athletes', { firstName: 'Тест', lastName: last, birthYear: 2000, countryId: fx.ru, clubName: 'Клуб' });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      const r = await as('org').post(`/tournaments/${tournamentId}/athletes`, { athleteId: a.body.id });
      expect(r.status).toBe(201);
      entries.push(r.body.id);
    }
    const m = await as('org').post(`/tournaments/${tournamentId}/matches`, {
      disciplineId: fx.mma,
      redEntryId: entries[0],
      blueEntryId: entries[1],
      ruleVersionId: fx.ruleVersionId,
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    matchId = m.body.id;

    // Not ready without a chief judge.
    expect((await command('org', { type: 'match.ready' })).body.code).toBe('RULE_VIOLATION');
    const chiefId = (await as('org').get('/users/officials')).body.find((u: any) => u.login === 'chief').id;
    const judgeId = (await as('org').get('/users/officials')).body.find((u: any) => u.login === 'judge').id;
    expect((await as('org').put(`/matches/${matchId}/officials`, { officials: [{ userId: chiefId, role: 'chief_judge' }, { userId: judgeId, role: 'judge' }] })).status).toBe(200);
    await accept('org', { type: 'match.ready' });
    expect(version).toBe(1);
  });

  it('enforces official permissions from the rule profile', async () => {
    expect((await command('other', { type: 'match.start' })).status).toBe(403);
    expect((await as('other').get(`/matches/${matchId}`)).status).toBe(403);
    expect((await command('judge', { type: 'match.start' })).status).toBe(403);
    await accept('chief', { type: 'match.start' });
    expect((await command('judge', { type: 'timer.start' })).status).toBe(403);
  });

  it('is idempotent per commandId and rejects stale versions for state-dependent commands', async () => {
    const commandId = randomUUID();
    const first = await command('judge', { type: 'score.add', side: 'red', code: 'p2' }, { commandId });
    expect(first.body.status).toBe('accepted');
    const again = await command('judge', { type: 'score.add', side: 'red', code: 'p2' }, { commandId });
    expect(again.body.status).toBe('duplicate');
    version = first.body.version;
    const stale = await command('chief', { type: 'timer.start' }, { expectedVersion: version - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    const snap = await as('chief').get(`/matches/${matchId}`);
    expect(snap.body.state.score).toEqual({ red: 2, blue: 0 });
  });

  it('applies concurrent additive commands from several judges without losing any', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) => command(i % 2 ? 'chief' : 'judge', { type: 'score.add', side: 'blue', code: 'p1' })),
    );
    expect(results.map((r) => (r.status === 200 ? 200 : `${r.status} ${r.body.code}`))).toEqual(Array(25).fill(200));
    const snap = await as('chief').get(`/matches/${matchId}`);
    expect(snap.body.state.score.blue).toBe(25);
    version = snap.body.version;
    const events = (await as('chief').get(`/matches/${matchId}/events`)).body;
    const seqs = events.map((e: any) => Number(e.seq)).sort((a: number, b: number) => a - b);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  });

  it('syncs committed state to officials and the public display over WebSocket', async () => {
    const d = await as('org').post('/displays', { tournamentId, name: 'TV' });
    expect(d.status).toBe(201);
    displayToken = d.body.public_token;
    expect((await as('org').put(`/displays/${d.body.id}/match`, { matchId })).status).toBe(200);

    const unauth = io(`${url}/realtime`, { transports: ['websocket'], extraHeaders: { Origin: 'http://localhost:3000' } });
    // Rejected during the handshake (namespace middleware): the client never gets connected.
    const rejection = await new Promise<string>((resolve) => unauth.on('connect_error', (e) => resolve(e.message)));
    expect(rejection).toBe('UNAUTHENTICATED');
    expect(unauth.connected).toBe(false);
    unauth.close();

    const ticket = (await as('chief').post('/auth/realtime-ticket')).body.ticket;
    const judgeSock: Socket = io(`${url}/realtime`, { transports: ['websocket'], auth: { ticket }, extraHeaders: { Origin: 'http://localhost:3000' } });
    const tv: Socket = io(`${url}/public`, { transports: ['websocket'], extraHeaders: { Origin: 'http://localhost:3000' } });
    try {
      const sub = await judgeSock.timeout(5000).emitWithAck('match.subscribe', { matchId });
      expect(sub.ok).toBe(true);
      const tvSub = await tv.timeout(5000).emitWithAck('display.subscribe', { token: displayToken });
      expect(tvSub.ok).toBe(true);
      expect(tvSub.view.match.red.name).toBe('Красный Тест');
      expect(tvSub.view.match).not.toHaveProperty('officials');

      const judgeUpdate = new Promise<any>((r) => judgeSock.once('match.state', r));
      const tvUpdate = new Promise<any>((r) => tv.once('display.match', r));
      const ack = await judgeSock.timeout(5000).emitWithAck('match.command', {
        matchId,
        commandId: randomUUID(),
        expectedVersion: version,
        command: { type: 'penalty.add', side: 'red', code: 'w' },
      });
      expect(ack.ok, JSON.stringify(ack)).toBe(true);
      version = ack.result.version;
      expect((await judgeUpdate).version).toBe(version);
      const pub = await tvUpdate;
      expect(pub.blue.score).toBe(26);
      expect(pub.red.penalties).toEqual([{ code: 'w', label: 'W', count: 1 }]);

      // The public namespace has no command handler: nothing is applied.
      tv.emit('match.command', { matchId, commandId: randomUUID(), expectedVersion: version, command: { type: 'score.add', side: 'red', code: 'p2' } });
      await new Promise((r) => setTimeout(r, 300));
      expect((await as('chief').get(`/matches/${matchId}`)).body.version).toBe(version);
    } finally {
      judgeSock.close();
      tv.close();
    }
  });

  it('records corrections as new events and keeps the log append-only', async () => {
    const events = (await as('chief').get(`/matches/${matchId}/events`)).body;
    const target = events.find((e: any) => e.type === 'score.add' && e.payload.side === 'red');
    await accept('chief', { type: 'event.void', eventId: target.id, reason: 'ошибка судьи' });
    const snap = await as('chief').get(`/matches/${matchId}`);
    expect(snap.body.state.score.red).toBe(0);
    const after = (await as('chief').get(`/matches/${matchId}/events`)).body;
    expect(after.find((e: any) => e.id === target.id).voided).toBe(true);
    const c = db();
    await c.connect();
    await expect(c.query(`UPDATE match_events SET type = 'x' WHERE match_id = $1`, [matchId])).rejects.toThrow(/append-only/);
    await c.end();
  });

  it('expires the timer on the server and restores a running timer after restart', async () => {
    await accept('chief', { type: 'period.next' });
    await accept('chief', { type: 'timer.start' });
    await app.close();
    ({ app, url } = await startApp());
    await new Promise((r) => setTimeout(r, 2600));
    const snap = await as('chief').get(`/matches/${matchId}`);
    expect(snap.body.state.timer).toEqual({ status: 'stopped', remainingMs: 0, startedAt: null });
    const events = (await as('chief').get(`/matches/${matchId}/events`)).body;
    expect(events[0]).toMatchObject({ type: 'timer.expire', actor_role: 'system' });
    version = snap.body.version;
  }, 20_000);

  it('ends the match, requires confirmation and stores an immutable result', async () => {
    expect((await command('judge', { type: 'match.end', outcomeCode: 'points', winnerSide: 'blue' })).status).toBe(403);
    await accept('chief', { type: 'match.end', outcomeCode: 'points', winnerSide: 'blue' });
    expect((await as('chief').get(`/matches/${matchId}`)).body.status).toBe('awaiting_confirmation');
    await accept('chief', { type: 'result.confirm' });
    const snap = await as('chief').get(`/matches/${matchId}`);
    expect(snap.body.status).toBe('completed');
    expect(snap.body.result).toMatchObject({ winner_side: 'blue', outcome_code: 'points' });
    expect((await command('chief', { type: 'score.add', side: 'red', code: 'p1' })).status).toBe(422);
    const pub = await api().get(`/api/public/displays/${displayToken}`);
    expect(pub.body.match.result).toEqual({ winnerSide: 'blue', outcome: 'Очки' });
    const audit = new pg.Client({ connectionString: TEST_DB });
    await audit.connect();
    const actions = (await audit.query(`SELECT action FROM audit_log`)).rows.map((r) => r.action);
    await expect(audit.query(`DELETE FROM match_results`)).rejects.toThrow(/append-only/);
    await audit.end();
    expect(actions).toEqual(expect.arrayContaining(['auth.login', 'tournament.create', 'match.create', 'match.officials', 'display.assign']));
  });

  const ruleDef = {
    periods: { count: 3, durationSec: 180 },
    scoring: [{ code: 's1', label: '+1', points: 1 }],
    penalties: [{ code: 'w1', label: 'Замечание', public: true, opponentPoints: 0 }],
    endMethods: [{ code: 'points', label: 'По очкам', requiresWinner: true }],
    roles: { chief_judge: ['score', 'penalty', 'timer', 'period', 'correct', 'end', 'confirm'], judge: ['score'] },
    timeAdjust: { maxSec: 30 },
  };

  it('lets an organizer create, edit and publish rule profiles; approved versions stay immutable and bound to matches', async () => {
    const list = await as('org').get('/rule-profiles');
    expect(list.status).toBe(200);
    expect(list.body.abilities).toEqual({ manageAll: true, create: true, approveOfficial: false });

    const broken = { ...ruleDef, roles: { chief_judge: ['score', 'timer', 'end'], judge: [] } };
    expect((await as('org').post('/rule-profiles', { name: 'Без подтверждения', disciplineId: fx.mma, definition: broken })).status).toBe(400);
    expect((await as('judge').post('/rule-profiles', { name: 'Судейский', disciplineId: fx.mma, definition: ruleDef })).status).toBe(403);

    const created = await as('org').post('/rule-profiles', { name: 'Клубный профиль', description: 'Для тренировочных турниров', disciplineId: fx.mma, definition: ruleDef });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const { id: profileId, versionId: v1 } = created.body;
    const edited = await as('org').put(`/rule-versions/${v1}`, { definition: { ...ruleDef, periods: { count: 2, durationSec: 120 } }, changeSummary: 'Два раунда' });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect((await as('org').post(`/rule-versions/${v1}/publish`)).status).toBe(201);
    expect((await as('org').put(`/rule-versions/${v1}`, { definition: ruleDef })).status).toBe(409);
    expect((await api().delete(`/api/rule-versions/${v1}`).set(H).set('Cookie', cookies.org)).status).toBe(409);

    const t = await as('org').post('/tournaments', { name: 'Rules Cup', startsOn: '2026-10-18', endsOn: '2026-10-18', disciplineIds: [fx.mma] });
    const m = await as('org').post(`/tournaments/${t.body.id}/matches`, { disciplineId: fx.mma, ruleVersionId: v1 });
    expect(m.status, JSON.stringify(m.body)).toBe(201);

    const v2 = await as('org').post(`/rule-profiles/${profileId}/versions`, {});
    expect(v2.status, JSON.stringify(v2.body)).toBe(201);
    expect(v2.body.versionNumber).toBe(2);
    expect((await as('org').post(`/rule-profiles/${profileId}/versions`, {})).status).toBe(409);
    expect((await as('org').post(`/rule-versions/${v2.body.id}/publish`)).status).toBe(201);
    expect((await as('org').post(`/rule-versions/${v1}/archive`)).status).toBe(201);
    const snap = await as('org').get(`/matches/${m.body.id}`);
    expect(snap.body.rules).toMatchObject({ versionId: v1, versionNumber: 1 });
    expect((await as('org').post(`/tournaments/${t.body.id}/matches`, { disciplineId: fx.mma, ruleVersionId: v1 })).status).toBe(400);

    const detail = await as('org').get(`/rule-profiles/${profileId}`);
    expect(detail.body.versions.map((v: any) => [v.version_number, v.status, v.matches_count])).toEqual([
      [2, 'approved', 0],
      [1, 'archived', 1],
    ]);

    const official = await as('org').post('/rule-profiles', {
      name: 'Официальный регламент',
      disciplineId: fx.mma,
      official: true,
      source: { title: 'Регламент', edition: '2026' },
      definition: ruleDef,
    });
    expect(official.status).toBe(201);
    const denied = await as('org').post(`/rule-versions/${official.body.versionId}/publish`);
    expect(denied.status).toBe(403);
    expect(denied.body.details).toEqual({ permission: 'rules.approve' });

    expect((await as('org').post(`/rule-profiles/${profileId}/archive`)).status).toBe(201);
    expect((await as('org').post(`/rule-profiles/${profileId}/versions`, {})).status).toBe(409);
  });

  it('keeps self-registered organizers rule profiles private and copies as non-official drafts', async () => {
    const reg = await api().post('/api/auth/register').set(H).send({ login: 'rules.self', displayName: 'Rules Self', password: PASSWORD });
    expect(reg.status).toBe(201);
    const self = reg.headers['set-cookie'][0].split(';')[0];
    const asSelf = {
      get: (p: string) => api().get(`/api${p}`).set('Cookie', self),
      post: (p: string, body: object = {}) => api().post(`/api${p}`).set(H).set('Cookie', self).send(body),
    };
    expect((await asSelf.get('/rule-profiles')).body.abilities).toEqual({ manageAll: false, create: true, approveOfficial: false });
    expect((await asSelf.post('/rule-profiles', { name: 'Мой официальный', disciplineId: fx.mma, official: true, definition: ruleDef })).status).toBe(403);
    const mine = await asSelf.post('/rule-profiles', { name: 'Мой профиль', disciplineId: fx.mma, definition: ruleDef });
    expect(mine.status, JSON.stringify(mine.body)).toBe(201);
    expect((await asSelf.post(`/rule-versions/${mine.body.versionId}/publish`)).status).toBe(201);

    const seen = (who: string) => as(who).get('/rule-profiles').then((r) => r.body.profiles.some((p: any) => p.id === mine.body.id));
    expect(await seen('judge')).toBe(false);
    expect(await seen('org')).toBe(true);
    expect((await as('judge').get(`/rule-profiles/${mine.body.id}`)).status).toBe(404);
    expect((await as('judge').get('/rule-versions')).body.some((v: any) => v.id === mine.body.versionId)).toBe(false);

    const fixtureProfile = (await as('org').get('/rule-versions')).body.find((v: any) => v.id === fx.ruleVersionId).profile_id;
    const copy = await asSelf.post(`/rule-profiles/${fixtureProfile}/duplicate`, {});
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    const copied = await asSelf.get(`/rule-profiles/${copy.body.id}`);
    expect(copied.body).toMatchObject({ visibility: 'private', name: 'Копия: E2E fixture' });
    expect(copied.body.versions[0]).toMatchObject({ status: 'draft', is_demo: true, version_number: 1 });
    expect((await asSelf.post(`/rule-profiles/${fixtureProfile}/archive`)).status).toBe(403);
  });

  it('lets a user rename themselves and change the password, revoking their other sessions', async () => {
    const reg = await api().post('/api/auth/register').set(H).send({ login: 'acct.user', displayName: 'Acct', password: PASSWORD });
    const a = reg.headers['set-cookie'][0].split(';')[0];
    const second = await api().post('/api/auth/login').set(H).send({ login: 'acct.user', password: PASSWORD });
    const b = second.headers['set-cookie'][0].split(';')[0];

    const renamed = await api().put('/api/auth/me').set(H).set('Cookie', a).send({ displayName: 'Новое имя', roles: ['owner'] });
    expect(renamed.status).toBe(200);
    expect(renamed.body.user.displayName).toBe('Новое имя');
    expect(renamed.body.roles.map((r: any) => r.code)).toEqual(['organizer_self']);

    const wrong = await api().post('/api/auth/password').set(H).set('Cookie', a).send({ currentPassword: 'not-it-123', newPassword: 'brand-new-pass-1' });
    expect(wrong.status).toBe(400);
    const ok = await api().post('/api/auth/password').set(H).set('Cookie', a).send({ currentPassword: PASSWORD, newPassword: 'brand-new-pass-1' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.revokedSessions).toBe(1);
    expect((await api().get('/api/auth/me').set('Cookie', a)).status).toBe(200);
    expect((await api().get('/api/auth/me').set('Cookie', b)).status).toBe(401);
    expect((await api().post('/api/auth/login').set(H).send({ login: 'acct.user', password: PASSWORD })).status).toBe(401);
    expect((await api().post('/api/auth/login').set(H).send({ login: 'acct.user', password: 'brand-new-pass-1' })).status).toBe(200);
  });
});
