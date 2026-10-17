import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { parse, uuid } from '../../common/validation.js';
import { DatabaseService, type Db } from '../../database/database.service.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ClientIp, CurrentUser } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';
import { MatchesService } from './matches.service.js';

const setupSchema = z
  .object({
    disciplineId: uuid,
    redEntryId: uuid.nullish(),
    blueEntryId: uuid.nullish(),
    ruleVersionId: uuid.nullish(),
    scheduledAt: z.string().datetime({ offset: true }).nullish(),
  })
  .refine((s) => !s.redEntryId || s.redEntryId !== s.blueEntryId, {
    message: 'Один спортсмен не может выступать за обе стороны',
    path: ['blueEntryId'],
  });

const officialsSchema = z.object({
  officials: z
    .array(z.object({ userId: uuid, role: z.enum(['chief_judge', 'judge']) }))
    .max(10)
    .refine((o) => o.filter((x) => x.role === 'chief_judge').length <= 1, 'Главный судья может быть только один')
    .refine((o) => new Set(o.map((x) => x.userId)).size === o.length, 'Судья указан дважды'),
});

@Controller()
export class MatchesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly matches: MatchesService,
  ) {}

  @Get('rule-versions')
  ruleVersions(@Query('disciplineId') disciplineId?: string) {
    return this.db.query(
      `SELECT v.id, v.version_number, v.status, v.is_demo, v.engine, v.engine_version, v.definition,
              v.source_title, v.source_edition, v.effective_from, v.change_summary,
              p.id AS profile_id, p.name AS profile_name, d.id AS discipline_id, d.name AS discipline_name
         FROM rule_profile_versions v
         JOIN rule_profiles p ON p.id = v.rule_profile_id
         JOIN disciplines d ON d.id = p.discipline_id
        WHERE ($1::uuid IS NULL OR d.id = $1)
        ORDER BY d.name, p.name, v.version_number DESC`,
      [disciplineId ? parse(uuid, disciplineId) : null],
    );
  }

  @Get('matches')
  async list(@CurrentUser() user: SessionUser, @Query('tournamentId') tournamentId?: string, @Query('status') status?: string) {
    const visible = await this.access.visibleTournamentIds(user.id);
    return this.db.query(
      `SELECT m.id, m.match_number, m.status, m.scheduled_at, m.tournament_id, t.name AS tournament_name, d.name AS discipline_name,
              ms.score, ms.version,
              (SELECT a.last_name || ' ' || a.first_name FROM match_participants mp JOIN tournament_athletes ta ON ta.id = mp.tournament_athlete_id
                 JOIN athletes a ON a.id = ta.athlete_id WHERE mp.match_id = m.id AND mp.side = 'red') AS red_name,
              (SELECT a.last_name || ' ' || a.first_name FROM match_participants mp JOIN tournament_athletes ta ON ta.id = mp.tournament_athlete_id
                 JOIN athletes a ON a.id = ta.athlete_id WHERE mp.match_id = m.id AND mp.side = 'blue') AS blue_name,
              mr.winner_side,
              EXISTS (SELECT 1 FROM match_officials mo WHERE mo.match_id = m.id AND mo.user_id = $4) AS is_official
         FROM matches m
         JOIN tournaments t ON t.id = m.tournament_id
         JOIN disciplines d ON d.id = m.discipline_id
         JOIN match_states ms ON ms.match_id = m.id
         LEFT JOIN match_results mr ON mr.match_id = m.id
        WHERE ($1::uuid[] IS NULL OR m.tournament_id = ANY($1)
               OR EXISTS (SELECT 1 FROM match_officials mo WHERE mo.match_id = m.id AND mo.user_id = $4))
          AND ($2::uuid IS NULL OR m.tournament_id = $2)
          AND ($3::text IS NULL OR m.status = $3)
        ORDER BY (m.status IN ('live','awaiting_confirmation')) DESC, t.starts_on DESC, m.match_number`,
      [visible, tournamentId ? parse(uuid, tournamentId) : null, status || null, user.id],
    );
  }

  @Get('matches/:id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    await this.matches.requireView(user.id, parse(uuid, id));
    const snap = await this.matches.snapshot(id);
    const viewer = await this.matches.viewer(user.id, id, snap.tournament.id, snap.rules?.definition ?? null);
    return { ...snap, viewer };
  }

  @Get('matches/:id/events')
  async events(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    await this.matches.requireView(user.id, parse(uuid, id));
    return this.db.query(
      `SELECT e.id, e.seq, e.type, e.payload, e.actor_role, e.reason, e.corrects_event_id, e.server_time,
              u.display_name AS actor_name,
              EXISTS (SELECT 1 FROM match_events v WHERE v.corrects_event_id = e.id) AS voided
         FROM match_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.match_id = $1 ORDER BY e.seq DESC`,
      [id],
    );
  }

  @Post('tournaments/:id/matches')
  async create(@CurrentUser() user: SessionUser, @Param('id') tournamentId: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    await this.access.require(user.id, 'tournament.manage', parse(uuid, tournamentId));
    const s = parse(setupSchema, body);
    return this.db.tx(async (c) => {
      await c.query(`SELECT id FROM tournaments WHERE id = $1 FOR UPDATE`, [tournamentId]);
      const m = await this.db.one(
        `INSERT INTO matches (tournament_id, discipline_id, match_number, scheduled_at, created_by)
         VALUES ($1, $2, (SELECT coalesce(max(match_number), 0) + 1 FROM matches WHERE tournament_id = $1), $3, $4)
         RETURNING id, match_number`,
        [tournamentId, s.disciplineId, s.scheduledAt ?? null, user.id],
        c,
      );
      await this.db.query(
        `INSERT INTO match_states (match_id, score, penalties) VALUES ($1, '{"red":0,"blue":0}', '{"red":{},"blue":{}}')`,
        [m.id],
        c,
      );
      await this.applySetup(m.id, tournamentId, s, c);
      await this.audit.record(
        { actorUserId: user.id, action: 'match.create', entityType: 'match', entityId: m.id, tournamentId, data: s, ip },
        c,
      );
      return m;
    });
  }

  @Put('matches/:id/setup')
  async setup(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const m = await this.lockPrepared(parse(uuid, id), user);
    const s = parse(setupSchema, body);
    return this.db.tx(async (c) => {
      const row = await this.db.one(`SELECT status FROM matches WHERE id = $1 FOR UPDATE`, [id], c);
      if (row.status !== 'prepared') throw new AppError('INVALID_TRANSITION', 'Состав можно менять только у подготавливаемого поединка');
      await this.db.query(`UPDATE matches SET discipline_id = $2, scheduled_at = $3, updated_at = now() WHERE id = $1`, [id, s.disciplineId, s.scheduledAt ?? null], c);
      await this.applySetup(id, m.tournament_id, s, c);
      await this.audit.record(
        { actorUserId: user.id, action: 'match.setup', entityType: 'match', entityId: id, tournamentId: m.tournament_id, data: s, ip },
        c,
      );
      return { ok: true };
    });
  }

  @Put('matches/:id/officials')
  async officials(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const m = await this.db.one(`SELECT tournament_id, status FROM matches WHERE id = $1`, [parse(uuid, id)]);
    if (!m) throw new AppError('NOT_FOUND', 'Поединок не найден');
    await this.access.require(user.id, 'tournament.manage', m.tournament_id);
    const { officials } = parse(officialsSchema, body);
    return this.db.tx(async (c) => {
      const row = await this.db.one(`SELECT status FROM matches WHERE id = $1 FOR UPDATE`, [id], c);
      if (!['prepared', 'ready'].includes(row.status)) {
        throw new AppError('INVALID_TRANSITION', 'Судей можно менять только до начала поединка');
      }
      if (row.status === 'ready' && !officials.some((o) => o.role === 'chief_judge')) {
        throw new AppError('VALIDATION', 'У готового к старту поединка должен быть главный судья');
      }
      // Same rule as GET /tournaments/:id/officials: judges of this tournament, plus system judges
      // only when the caller manages tournaments system-wide.
      const systemManager = await this.access.can(user.id, 'tournament.manage', null, c);
      for (const o of officials) {
        const ok = await this.db.one(
          `SELECT 1 FROM users u JOIN user_role_assignments ura ON ura.user_id = u.id
             JOIN role_permissions rp ON rp.role_id = ura.role_id AND rp.permission = 'match.officiate'
            WHERE u.id = $1 AND u.is_active AND u.password_hash IS NOT NULL
              AND ((ura.scope_type = 'tournament' AND ura.tournament_id = $2) OR (ura.scope_type = 'system' AND $3))
            LIMIT 1`,
          [o.userId, m.tournament_id, systemManager],
          c,
        );
        if (!ok) throw new AppError('VALIDATION', 'Судьёй можно назначить только активного пользователя с ролью судьи и локальным паролем');
      }
      await this.db.query(`DELETE FROM match_officials WHERE match_id = $1`, [id], c);
      for (const o of officials) {
        await this.db.query(
          `INSERT INTO match_officials (match_id, user_id, official_role, assigned_by) VALUES ($1, $2, $3, $4)`,
          [id, o.userId, o.role, user.id],
          c,
        );
      }
      await this.audit.record(
        { actorUserId: user.id, action: 'match.officials', entityType: 'match', entityId: id, tournamentId: m.tournament_id, data: { officials }, ip },
        c,
      );
      return { ok: true };
    });
  }

  @Get('results')
  async results(@CurrentUser() user: SessionUser) {
    const visible = await this.access.visibleTournamentIds(user.id);
    return this.db.query(
      `SELECT m.id, m.match_number, t.name AS tournament_name, mr.winner_side, mr.outcome_code, mr.confirmed_at,
              mr.participants_snapshot, mr.final_state, rpv.definition
         FROM match_results mr
         JOIN matches m ON m.id = mr.match_id
         JOIN tournaments t ON t.id = m.tournament_id
         JOIN rule_profile_versions rpv ON rpv.id = mr.rule_profile_version_id
        WHERE ($1::uuid[] IS NULL OR m.tournament_id = ANY($1))
        ORDER BY mr.confirmed_at DESC LIMIT 50`,
      [visible],
    );
  }

  private async lockPrepared(id: string, user: SessionUser) {
    const m = await this.db.one(`SELECT tournament_id, status FROM matches WHERE id = $1`, [id]);
    if (!m) throw new AppError('NOT_FOUND', 'Поединок не найден');
    await this.access.require(user.id, 'tournament.manage', m.tournament_id);
    return m;
  }

  private async applySetup(matchId: string, tournamentId: string, s: z.infer<typeof setupSchema>, c: Db) {
    if (s.ruleVersionId) {
      const v = await this.db.one(
        `SELECT v.status, p.discipline_id FROM rule_profile_versions v JOIN rule_profiles p ON p.id = v.rule_profile_id WHERE v.id = $1`,
        [s.ruleVersionId],
        c,
      );
      if (!v || v.status !== 'approved') throw new AppError('VALIDATION', 'Можно выбрать только утверждённую версию правил');
      if (v.discipline_id !== s.disciplineId) throw new AppError('VALIDATION', 'Версия правил относится к другой дисциплине');
    }
    await this.db.query(`UPDATE matches SET rule_profile_version_id = $2 WHERE id = $1`, [matchId, s.ruleVersionId ?? null], c);
    await this.db.query(`DELETE FROM match_participants WHERE match_id = $1`, [matchId], c);
    for (const [side, entry] of [
      ['red', s.redEntryId],
      ['blue', s.blueEntryId],
    ] as const) {
      if (!entry) continue;
      const ok = await this.db.one(
        `SELECT 1 FROM tournament_athletes WHERE id = $1 AND tournament_id = $2 AND status = 'registered'`,
        [entry, tournamentId],
        c,
      );
      if (!ok) throw new AppError('VALIDATION', 'Спортсмен не зарегистрирован в этом турнире');
      await this.db.query(`INSERT INTO match_participants (match_id, side, tournament_athlete_id) VALUES ($1, $2, $3)`, [matchId, side, entry], c);
    }
  }
}
