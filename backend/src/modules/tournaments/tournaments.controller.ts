import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../../common/password.js';
import { isoDate, login, parse, trimmed, uuid } from '../../common/validation.js';
import { DatabaseService, type Db } from '../../database/database.service.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ClientIp, CurrentUser } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';

const tournamentSchema = z
  .object({
    name: trimmed(160),
    startsOn: isoDate,
    endsOn: isoDate,
    venue: z.string().trim().max(200).nullish(),
    status: z.enum(['draft', 'scheduled', 'active', 'completed']).default('draft'),
    disciplineIds: z.array(uuid).min(1, 'Выберите хотя бы одну дисциплину'),
  })
  .refine((t) => t.endsOn >= t.startsOn, { message: 'Дата окончания раньше даты начала', path: ['endsOn'] });

const registerSchema = z.object({ athleteId: uuid, registrationNumber: z.string().trim().max(40).nullish() });

const bulkRegisterSchema = z.object({
  athleteIds: z
    .array(uuid)
    .min(1, 'Выберите хотя бы одного спортсмена')
    .max(200, 'За один раз можно зарегистрировать не больше 200 спортсменов')
    .refine((ids) => new Set(ids).size === ids.length, 'Спортсмен выбран дважды'),
});

const judgeSchema = z.object({
  login,
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  role: z.enum(['chief_judge', 'judge']),
});

@Controller()
export class TournamentsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get('disciplines')
  disciplines() {
    return this.db.query(`SELECT id, code, name FROM disciplines WHERE archived_at IS NULL ORDER BY name`);
  }

  @Get('tournaments')
  async list(@CurrentUser() user: SessionUser) {
    const [visible, grants] = await Promise.all([this.access.visibleTournamentIds(user.id), this.access.grants(user.id)]);
    const manage = grants.filter((g) => g.permission === 'tournament.manage');
    const manageAll = manage.some((g) => g.scope_type === 'system');
    const managed = manage.map((g) => g.tournament_id).filter((id): id is string => !!id);
    const rows = await this.db.query(
      `SELECT t.id, t.name, t.starts_on, t.ends_on, t.venue, t.status, t.archived_at,
              (SELECT string_agg(d.name, ', ' ORDER BY d.name) FROM tournament_disciplines td JOIN disciplines d ON d.id = td.discipline_id
                WHERE td.tournament_id = t.id) AS disciplines,
              (SELECT count(*) FROM tournament_athletes ta WHERE ta.tournament_id = t.id)::int AS athletes_count,
              (SELECT count(*) FROM matches m WHERE m.tournament_id = t.id)::int AS matches_count,
              (SELECT count(*) FROM matches m WHERE m.tournament_id = t.id AND m.status = 'completed')::int AS completed_count,
              (SELECT count(*) FROM matches m WHERE m.tournament_id = t.id AND m.status IN ('live','awaiting_confirmation'))::int AS live_count
         FROM tournaments t
        WHERE ($1::uuid[] IS NULL OR t.id = ANY($1))
        ORDER BY t.archived_at NULLS FIRST, t.starts_on DESC`,
      [visible],
    );
    // UI hint only: every management request is still checked by access.require.
    return rows.map((t) => ({ ...t, can_manage: manageAll || managed.includes(t.id) }));
  }

  @Get('tournaments/:id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    await this.ensureVisible(user, parse(uuid, id));
    const t = await this.db.one(`SELECT * FROM tournaments WHERE id = $1`, [id]);
    if (!t) throw new AppError('NOT_FOUND', 'Турнир не найден');
    const [disciplines, athletes] = await Promise.all([
      this.db.query(
        `SELECT d.id, d.code, d.name FROM tournament_disciplines td JOIN disciplines d ON d.id = td.discipline_id
          WHERE td.tournament_id = $1 ORDER BY d.name`,
        [id],
      ),
      this.db.query(
        `SELECT ta.id, ta.registration_number, ta.status, a.id AS athlete_id, a.first_name, a.last_name,
                c.iso_alpha2 AS country_code, c.name AS country_name, cl.name AS club_name
           FROM tournament_athletes ta
           JOIN athletes a ON a.id = ta.athlete_id
           JOIN countries c ON c.id = a.country_id
           LEFT JOIN clubs cl ON cl.id = a.club_id
          WHERE ta.tournament_id = $1 ORDER BY lower(a.last_name), lower(a.first_name)`,
        [id],
      ),
    ]);
    const canManage = await this.access.can(user.id, 'tournament.manage', id);
    return { ...t, disciplines, athletes, canManage };
  }

  @Post('tournaments')
  async create(@CurrentUser() user: SessionUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    const systemManager = await this.access.can(user.id, 'tournament.manage');
    if (!systemManager && !(await this.access.can(user.id, 'tournament.create'))) {
      throw new AppError('FORBIDDEN', 'Недостаточно прав для создания турнира', { permission: 'tournament.create' });
    }
    const t = parse(tournamentSchema, body);
    return this.db.tx(async (c) => {
      const row = await this.db.one(
        `INSERT INTO tournaments (name, starts_on, ends_on, venue, status, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [t.name, t.startsOn, t.endsOn, t.venue ?? null, t.status, user.id],
        c,
      );
      if (!systemManager) {
        // Self-service organizers manage only the tournaments they create.
        await this.db.query(
          `INSERT INTO user_role_assignments (user_id, role_id, scope_type, tournament_id, granted_by)
           SELECT $1, id, 'tournament', $2, $1 FROM roles WHERE code = 'organizer'`,
          [user.id, row.id],
          c,
        );
      }
      await this.setDisciplines(row.id, t.disciplineIds, c);
      await this.audit.record(
        { actorUserId: user.id, action: 'tournament.create', entityType: 'tournament', entityId: row.id, tournamentId: row.id, data: t, ip },
        c,
      );
      return row;
    });
  }

  @Put('tournaments/:id')
  async update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    await this.access.requireTournamentEdit(user.id, parse(uuid, id));
    const t = parse(tournamentSchema, body);
    return this.db.tx(async (c) => {
      const row = await this.db.one(
        `UPDATE tournaments SET name=$2, starts_on=$3, ends_on=$4, venue=$5, status=$6, updated_at=now() WHERE id=$1 RETURNING id`,
        [id, t.name, t.startsOn, t.endsOn, t.venue ?? null, t.status],
        c,
      );
      if (!row) throw new AppError('NOT_FOUND', 'Турнир не найден');
      await this.setDisciplines(id, t.disciplineIds, c);
      await this.audit.record(
        { actorUserId: user.id, action: 'tournament.update', entityType: 'tournament', entityId: id, tournamentId: id, data: t, ip },
        c,
      );
      return row;
    });
  }

  @Post('tournaments/:id/archive')
  async archive(@CurrentUser() user: SessionUser, @Param('id') id: string, @ClientIp() ip: string | null) {
    await this.access.require(user.id, 'tournament.manage', parse(uuid, id));
    await this.db.tx(async (c) => {
      // Every judge command writes under KEY SHARE on this row and only while the tournament is not archived
      // (ScoringService WRITE_SQL). FOR UPDATE here waits for commands in flight and blocks new ones, so the check
      // below sees their outcome and no match can start or change once the tournament is archived.
      await c.query(`SELECT id FROM tournaments WHERE id = $1 FOR UPDATE`, [id]);
      const active = await this.db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM matches WHERE tournament_id = $1 AND status IN ('live', 'awaiting_confirmation')`,
        [id],
        c,
      );
      if (active && active.n > 0) {
        throw new AppError('CONFLICT', `Нельзя отправить в архив: идёт или ждёт подтверждения поединков — ${active.n}. Завершите или отмените их, затем повторите.`, {
          activeMatches: active.n,
        });
      }
      await this.db.query(`UPDATE tournaments SET archived_at = coalesce(archived_at, now()), updated_at = now() WHERE id = $1`, [id], c);
      await this.audit.record({ actorUserId: user.id, action: 'tournament.archive', entityType: 'tournament', entityId: id, tournamentId: id, ip }, c);
    });
    return { ok: true };
  }

  /** Brings an archived tournament back to the current list. Its data were never changed by archiving. */
  @Post('tournaments/:id/unarchive')
  async unarchive(@CurrentUser() user: SessionUser, @Param('id') id: string, @ClientIp() ip: string | null) {
    await this.access.require(user.id, 'tournament.manage', parse(uuid, id));
    await this.db.tx(async (c) => {
      await this.db.query(`UPDATE tournaments SET archived_at = NULL, updated_at = now() WHERE id = $1`, [id], c);
      await this.audit.record({ actorUserId: user.id, action: 'tournament.unarchive', entityType: 'tournament', entityId: id, tournamentId: id, ip }, c);
    });
    return { ok: true };
  }

  /** Registers one athlete (optionally with a number). Same checks as the bulk endpoint, through registerEntries. */
  @Post('tournaments/:id/athletes')
  async register(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    await this.access.requireTournamentEdit(user.id, parse(uuid, id));
    const r = parse(registerSchema, body);
    return this.db.tx(async (c) => {
      const res = await this.registerEntries(c, user.id, id, [{ athleteId: r.athleteId, registrationNumber: r.registrationNumber || null }], ip);
      const skip = res.skipped[0];
      if (skip?.reason === 'not_found') throw new AppError('NOT_FOUND', 'Спортсмен не найден');
      if (skip) throw new AppError('CONFLICT', 'Спортсмен уже зарегистрирован в этом турнире');
      // Same response shape as before: the new entry id.
      return { id: res.registered[0].entryId };
    });
  }

  /**
   * Registers several athletes at once. Valid ones are inserted in one transaction and the rest come back with a
   * reason, so a partly invalid selection never loses the good part (see registerEntries).
   */
  @Post('tournaments/:id/athletes/bulk')
  async registerMany(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    await this.access.requireTournamentEdit(user.id, parse(uuid, id));
    const { athleteIds } = parse(bulkRegisterSchema, body);
    return this.db.tx((c) => this.registerEntries(c, user.id, id, athleteIds.map((athleteId) => ({ athleteId, registrationNumber: null })), ip));
  }

  /**
   * The one place with the registration rules, shared by the single and bulk endpoints. Each athlete must exist,
   * not be archived, be visible to the user by the same rule as GET /athletes, and not be registered yet. An athlete
   * the user cannot see is reported exactly like a missing one, so other organizers' bases are not revealed.
   * Runs inside the caller's transaction; the tournament row is locked so parallel registrations do not interleave.
   */
  private async registerEntries(c: Db, userId: string, tournamentId: string, entries: { athleteId: string; registrationNumber: string | null }[], ip: string | null) {
    await c.query(`SELECT id FROM tournaments WHERE id = $1 FOR UPDATE`, [tournamentId]);
    const all = await this.access.can(userId, 'athlete.manage', null, c);
    const visible = all ? null : await this.access.visibleTournamentIds(userId);
    const ids = entries.map((e) => e.athleteId);
    const rows = await this.db.query<{ id: string; ok: boolean; registered: boolean }>(
      `SELECT a.id,
              ($2::boolean OR $4::uuid[] IS NULL OR a.created_by = $3
               OR EXISTS (SELECT 1 FROM tournament_athletes v WHERE v.athlete_id = a.id AND v.tournament_id = ANY($4))) AS ok,
              EXISTS (SELECT 1 FROM tournament_athletes ta WHERE ta.athlete_id = a.id AND ta.tournament_id = $5) AS registered
         FROM athletes a
        WHERE a.id = ANY($1::uuid[]) AND a.archived_at IS NULL`,
      [ids, all, userId, visible, tournamentId],
      c,
    );
    const found = new Map(rows.map((r) => [r.id, r]));
    const skipped: { athleteId: string; reason: 'not_found' | 'already_registered' }[] = [];
    const toInsert: { athleteId: string; registrationNumber: string | null }[] = [];
    for (const e of entries) {
      const r = found.get(e.athleteId);
      if (!r || !r.ok) skipped.push({ athleteId: e.athleteId, reason: 'not_found' });
      else if (r.registered) skipped.push({ athleteId: e.athleteId, reason: 'already_registered' });
      else toInsert.push(e);
    }

    // ON CONFLICT covers a duplicate athlete only; a taken registration number still fails the whole statement,
    // which is the old behaviour of the single endpoint (bulk never sends numbers).
    const inserted = toInsert.length
      ? await this.db.query<{ id: string; athlete_id: string }>(
          `INSERT INTO tournament_athletes (tournament_id, athlete_id, registration_number)
           SELECT $1, x.athlete_id, x.registration_number FROM unnest($2::uuid[], $3::text[]) AS x(athlete_id, registration_number)
           ON CONFLICT (tournament_id, athlete_id) DO NOTHING
           RETURNING id, athlete_id`,
          [tournamentId, toInsert.map((e) => e.athleteId), toInsert.map((e) => e.registrationNumber)],
          c,
        )
      : [];
    const insertedIds = new Set(inserted.map((r) => r.athlete_id));
    for (const e of toInsert) if (!insertedIds.has(e.athleteId)) skipped.push({ athleteId: e.athleteId, reason: 'already_registered' });

    for (const r of inserted) {
      const e = toInsert.find((x) => x.athleteId === r.athlete_id);
      await this.audit.record(
        {
          actorUserId: userId,
          action: 'tournament.register_athlete',
          entityType: 'tournament_athlete',
          entityId: r.id,
          tournamentId,
          data: { athleteId: r.athlete_id, registrationNumber: e?.registrationNumber ?? null, bulk: entries.length > 1 },
          ip,
        },
        c,
      );
    }
    return { registered: inserted.map((r) => ({ athleteId: r.athlete_id, entryId: r.id })), skipped };
  }

  @Delete('tournaments/:id/athletes/:entryId')
  async unregister(@CurrentUser() user: SessionUser, @Param('id') id: string, @Param('entryId') entryId: string, @ClientIp() ip: string | null) {
    await this.access.requireTournamentEdit(user.id, parse(uuid, id));
    await this.db.tx(async (c) => {
      const used = await this.db.one(`SELECT 1 FROM match_participants WHERE tournament_athlete_id = $1 LIMIT 1`, [entryId], c);
      if (used) throw new AppError('CONFLICT', 'Спортсмен уже участвует в поединке; снимите его с поединка или отметьте как выбывшего');
      await this.db.query(`DELETE FROM tournament_athletes WHERE id = $1 AND tournament_id = $2`, [parse(uuid, entryId), id], c);
      await this.audit.record(
        { actorUserId: user.id, action: 'tournament.unregister_athlete', entityType: 'tournament_athlete', entityId: entryId, tournamentId: id, ip },
        c,
      );
    });
    return { ok: true };
  }

  /** Users that may officiate in this tournament (see eligibleOfficialsSql). */
  @Get('tournaments/:id/officials')
  async officials(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    await this.access.require(user.id, 'tournament.manage', parse(uuid, id));
    const systemManager = await this.access.can(user.id, 'tournament.manage');
    return this.db.query(
      `SELECT u.id, u.login, u.display_name,
              bool_or(ura.scope_type = 'tournament') AS tournament_account,
              array_agg(DISTINCT r.code) AS roles
         FROM users u
         JOIN user_role_assignments ura ON ura.user_id = u.id
         JOIN roles r ON r.id = ura.role_id
         JOIN role_permissions rp ON rp.role_id = ura.role_id AND rp.permission = 'match.officiate'
        WHERE u.is_active AND u.password_hash IS NOT NULL
          AND ((ura.scope_type = 'tournament' AND ura.tournament_id = $1) OR (ura.scope_type = 'system' AND $2))
        GROUP BY u.id ORDER BY u.display_name`,
      [id, systemManager],
    );
  }

  /** Creates a judge account that exists only for this tournament. Visitors can never grant themselves this. */
  @Post('tournaments/:id/judges')
  async createJudge(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    await this.access.requireTournamentEdit(user.id, parse(uuid, id));
    const j = parse(judgeSchema, body);
    const hash = await hashPassword(j.password);
    return this.db.tx(async (c) => {
      const created = await this.db.one(
        `INSERT INTO users (login, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, login, display_name`,
        [j.login, j.displayName, hash],
        c,
      );
      await this.db.query(
        `INSERT INTO user_role_assignments (user_id, role_id, scope_type, tournament_id, granted_by)
         SELECT $1, id, 'tournament', $2, $3 FROM roles WHERE code = $4`,
        [created.id, id, user.id, j.role],
        c,
      );
      await this.audit.record(
        { actorUserId: user.id, action: 'tournament.create_judge', entityType: 'user', entityId: created.id, tournamentId: id, data: { login: j.login, role: j.role }, ip },
        c,
      );
      return created;
    });
  }

  private async setDisciplines(tournamentId: string, ids: string[], c: Parameters<DatabaseService['query']>[2]) {
    const used = await this.db.query<{ discipline_id: string }>(
      `SELECT DISTINCT discipline_id FROM matches WHERE tournament_id = $1`,
      [tournamentId],
      c,
    );
    const missing = used.filter((u) => !ids.includes(u.discipline_id));
    if (missing.length) throw new AppError('CONFLICT', 'Нельзя убрать дисциплину, в которой уже есть поединки');
    await this.db.query(`DELETE FROM tournament_disciplines WHERE tournament_id = $1 AND NOT (discipline_id = ANY($2))`, [tournamentId, ids], c);
    await this.db.query(
      `INSERT INTO tournament_disciplines (tournament_id, discipline_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [tournamentId, ids],
      c,
    );
  }

  private async ensureVisible(user: SessionUser, id: string) {
    const visible = await this.access.visibleTournamentIds(user.id);
    if (visible && !visible.includes(id)) throw new AppError('FORBIDDEN', 'Нет доступа к этому турниру');
  }
}
