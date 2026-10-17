import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../../common/password.js';
import { isoDate, login, parse, trimmed, uuid } from '../../common/validation.js';
import { DatabaseService } from '../../database/database.service.js';
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
    const visible = await this.access.visibleTournamentIds(user.id);
    return this.db.query(
      `SELECT t.id, t.name, t.starts_on, t.ends_on, t.venue, t.status, t.archived_at,
              (SELECT count(*) FROM tournament_athletes ta WHERE ta.tournament_id = t.id)::int AS athletes_count,
              (SELECT count(*) FROM matches m WHERE m.tournament_id = t.id)::int AS matches_count,
              (SELECT count(*) FROM matches m WHERE m.tournament_id = t.id AND m.status IN ('live','awaiting_confirmation'))::int AS live_count
         FROM tournaments t
        WHERE ($1::uuid[] IS NULL OR t.id = ANY($1))
        ORDER BY t.archived_at NULLS FIRST, t.starts_on DESC`,
      [visible],
    );
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
    await this.access.require(user.id, 'tournament.manage', parse(uuid, id));
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
      await this.db.query(`UPDATE tournaments SET archived_at = coalesce(archived_at, now()), updated_at = now() WHERE id = $1`, [id], c);
      await this.audit.record({ actorUserId: user.id, action: 'tournament.archive', entityType: 'tournament', entityId: id, tournamentId: id, ip }, c);
    });
    return { ok: true };
  }

  @Post('tournaments/:id/athletes')
  async register(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    await this.access.require(user.id, 'tournament.manage', parse(uuid, id));
    const r = parse(registerSchema, body);
    return this.db.tx(async (c) => {
      const row = await this.db.one(
        `INSERT INTO tournament_athletes (tournament_id, athlete_id, registration_number) VALUES ($1,$2,$3) RETURNING id`,
        [id, r.athleteId, r.registrationNumber || null],
        c,
      );
      await this.audit.record(
        { actorUserId: user.id, action: 'tournament.register_athlete', entityType: 'tournament_athlete', entityId: row.id, tournamentId: id, data: r, ip },
        c,
      );
      return row;
    });
  }

  @Delete('tournaments/:id/athletes/:entryId')
  async unregister(@CurrentUser() user: SessionUser, @Param('id') id: string, @Param('entryId') entryId: string, @ClientIp() ip: string | null) {
    await this.access.require(user.id, 'tournament.manage', parse(uuid, id));
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
    await this.access.require(user.id, 'tournament.manage', parse(uuid, id));
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
