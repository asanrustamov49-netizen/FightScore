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
import { ScoringService } from '../scoring/scoring.service.js';
import { bracketSize, firstRound, MAX_BRACKET_SIZE, nextPosition, roundsOf } from './bracket.js';

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

const bracketSchema = z.object({
  disciplineId: uuid,
  ruleVersionId: uuid,
  /** Tournament entries in seeding order, best first. */
  entryIds: z
    .array(uuid)
    .min(2, 'Для сетки нужно хотя бы два участника')
    .max(MAX_BRACKET_SIZE, `В сетке не больше ${MAX_BRACKET_SIZE} участников`)
    .refine((ids) => new Set(ids).size === ids.length, 'Участник выбран дважды'),
});

const walkoverSchema = z.object({ side: z.enum(['red', 'blue']) });

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
    private readonly scoring: ScoringService,
  ) {}

  /** Rule versions the user may see: shared profiles, their own private ones, or all for rule managers. */
  @Get('rule-versions')
  async ruleVersions(@CurrentUser() user: SessionUser, @Query('disciplineId') disciplineId?: string) {
    const manageAll = await this.access.can(user.id, 'rules.manage');
    return this.db.query(
      `SELECT v.id, v.version_number, v.status, v.is_demo, v.engine, v.engine_version, v.definition,
              v.source_title, v.source_edition, v.effective_from, v.change_summary,
              p.id AS profile_id, p.name AS profile_name, p.archived_at AS profile_archived_at,
              d.id AS discipline_id, d.name AS discipline_name
         FROM rule_profile_versions v
         JOIN rule_profiles p ON p.id = v.rule_profile_id
         JOIN disciplines d ON d.id = p.discipline_id
        WHERE ($1::uuid IS NULL OR d.id = $1) AND (p.visibility = 'shared' OR p.created_by = $2 OR $3)
        ORDER BY d.name, p.name, v.version_number DESC`,
      [disciplineId ? parse(uuid, disciplineId) : null, user.id, manageAll],
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
      // Status is checked under the row lock: archiving or completing the tournament waits for us, or we see it.
      await c.query(`SELECT id FROM tournaments WHERE id = $1 FOR UPDATE`, [tournamentId]);
      await this.access.requireNotArchived(tournamentId, c);
      await this.access.requireMatchesOpen(tournamentId, c);
      const m = await this.insertMatch(c, tournamentId, s.disciplineId, user.id, s.scheduledAt ?? null);
      await this.applySetup(m.id, tournamentId, s, user.id, c);
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
      const row = await this.db.one(`SELECT status, bracket_id FROM matches WHERE id = $1 FOR UPDATE`, [id], c);
      if (row.bracket_id) throw new AppError('CONFLICT', 'Пары сетки задаются сеткой: состав этого поединка менять нельзя');
      if (row.status !== 'prepared') throw new AppError('INVALID_TRANSITION', 'Состав можно менять только у подготавливаемого поединка');
      await this.db.query(`UPDATE matches SET discipline_id = $2, scheduled_at = $3, updated_at = now() WHERE id = $1`, [id, s.disciplineId, s.scheduledAt ?? null], c);
      await this.applySetup(id, m.tournament_id, s, user.id, c);
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
    await this.access.requireTournamentEdit(user.id, m.tournament_id);
    await this.access.requireMatchesOpen(m.tournament_id);
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

  /** Brackets of a tournament with every position: pairs, results and who went through. Same visibility as GET /matches. */
  @Get('tournaments/:id/brackets')
  async brackets(@CurrentUser() user: SessionUser, @Param('id') tournamentId: string) {
    const id = parse(uuid, tournamentId);
    const visible = await this.access.visibleTournamentIds(user.id);
    if (visible && !visible.includes(id)) throw new AppError('NOT_FOUND', 'Турнир не найден');
    const brackets = await this.db.query(
      `SELECT b.id, b.discipline_id, d.name AS discipline_name, b.size, b.format, b.created_at,
              p.name AS rule_profile_name, v.version_number AS rule_version_number
         FROM brackets b
         JOIN disciplines d ON d.id = b.discipline_id
         JOIN rule_profile_versions v ON v.id = b.rule_profile_version_id
         JOIN rule_profiles p ON p.id = v.rule_profile_id
        WHERE b.tournament_id = $1 ORDER BY d.name`,
      [id],
    );
    if (!brackets.length) return [];
    const matches = await this.db.query(
      `SELECT m.id, m.bracket_id, m.bracket_round AS round, m.bracket_slot AS slot, m.match_number, m.status,
              ms.score, mr.winner_side, m.bracket_advanced_side AS advanced_side,
              (SELECT json_object_agg(mp.side, json_build_object('entry_id', ta.id, 'first_name', a.first_name, 'last_name', a.last_name,
                                                                   'country_code', co.iso_alpha2))
                 FROM match_participants mp
                 JOIN tournament_athletes ta ON ta.id = mp.tournament_athlete_id
                 JOIN athletes a ON a.id = ta.athlete_id
                 JOIN countries co ON co.id = a.country_id
                WHERE mp.match_id = m.id) AS sides
         FROM matches m
         JOIN match_states ms ON ms.match_id = m.id
         LEFT JOIN match_results mr ON mr.match_id = m.id
        WHERE m.tournament_id = $1 AND m.bracket_id IS NOT NULL
        ORDER BY m.bracket_round, m.bracket_slot`,
      [id],
    );
    return brackets.map((b) => ({ ...b, matches: matches.filter((m) => m.bracket_id === b.id) }));
  }

  /**
   * Creates a single-elimination bracket for one discipline: every match of every round at once, so the structure
   * is stored and the server can move winners on. Athletes come in seeding order (best first); missing seeds are
   * byes that go straight to round 2. One bracket per discipline; pairs are fixed afterwards (setup is refused).
   */
  @Post('tournaments/:id/brackets')
  async createBracket(@CurrentUser() user: SessionUser, @Param('id') tournamentId: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const id = parse(uuid, tournamentId);
    await this.access.require(user.id, 'tournament.manage', id);
    const b = parse(bracketSchema, body);
    return this.db.tx(async (c) => {
      // Same lock order as archiving (tournament row first, FOR UPDATE); status and archive are read under it,
      // so a tournament completed or archived a moment ago never gets a bracket.
      await c.query(`SELECT id FROM tournaments WHERE id = $1 FOR UPDATE`, [id]);
      await this.access.requireNotArchived(id, c);
      await this.access.requireMatchesOpen(id, c);
      const exists = await this.db.one(`SELECT 1 FROM brackets WHERE tournament_id = $1 AND discipline_id = $2`, [id, b.disciplineId], c);
      if (exists) throw new AppError('CONFLICT', 'Сетка для этой дисциплины уже создана');
      const ok = await this.db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM tournament_athletes WHERE id = ANY($1::uuid[]) AND tournament_id = $2 AND status = 'registered'`,
        [b.entryIds, id],
        c,
      );
      if (!ok || ok.n !== b.entryIds.length) throw new AppError('VALIDATION', 'Все участники сетки должны быть зарегистрированы в этом турнире');

      const size = bracketSize(b.entryIds.length);
      const rounds = roundsOf(size);
      const inserted = await this.db.one<{ id: string }>(
        `INSERT INTO brackets (tournament_id, discipline_id, rule_profile_version_id, size, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [id, b.disciplineId, b.ruleVersionId, size, user.id],
        c,
      );
      const bracket = inserted!;
      const setup = (red: string | null, blue: string | null) => ({ disciplineId: b.disciplineId, ruleVersionId: b.ruleVersionId, redEntryId: red, blueEntryId: blue });

      // Round 1: real pairs only; an athlete without an opponent (bye) is seated in round 2 right away.
      const byes = new Map<number, { red: string | null; blue: string | null }>();
      for (const p of firstRound(b.entryIds)) {
        if (p.red && p.blue) {
          const m = await this.insertMatch(c, id, b.disciplineId, user.id);
          await this.placeInBracket(c, m.id, bracket.id, 1, p.slot);
          await this.applySetup(m.id, id, setup(p.red, p.blue), user.id, c);
          continue;
        }
        const next = nextPosition(1, p.slot);
        const seat = byes.get(next.slot) ?? { red: null, blue: null };
        seat[next.side] = p.red ?? p.blue;
        byes.set(next.slot, seat);
      }
      // Later rounds: empty positions filled by winners (and round 2 by byes).
      for (let round = 2; round <= rounds; round++) {
        for (let slot = 0; slot < size / 2 ** round; slot++) {
          const seat = round === 2 ? byes.get(slot) : undefined;
          const m = await this.insertMatch(c, id, b.disciplineId, user.id);
          await this.placeInBracket(c, m.id, bracket.id, round, slot);
          await this.applySetup(m.id, id, setup(seat?.red ?? null, seat?.blue ?? null), user.id, c);
        }
      }
      await this.audit.record(
        { actorUserId: user.id, action: 'bracket.create', entityType: 'bracket', entityId: bracket.id, tournamentId: id, data: b, ip },
        c,
      );
      return { id: bracket.id, size };
    });
  }

  /**
   * Walkover in a bracket: when a match was cancelled or ended without a winner, the organizer names who goes
   * through. Only once per match (advanced side is set), never over a confirmed winner.
   */
  @Post('matches/:id/walkover')
  async walkover(@CurrentUser() user: SessionUser, @Param('id') matchId: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const mid = parse(uuid, matchId);
    const { side } = parse(walkoverSchema, body);
    const head = await this.db.one<{ tournament_id: string }>(`SELECT tournament_id FROM matches WHERE id = $1`, [mid]);
    if (!head) throw new AppError('NOT_FOUND', 'Поединок не найден');
    await this.access.require(user.id, 'tournament.manage', head.tournament_id);
    const done = await this.db.tx(async (c) => {
      // SHARE on the tournament row: conflicts with archiving (FOR UPDATE) and status changes, not with judges.
      await c.query(`SELECT id FROM tournaments WHERE id = $1 FOR SHARE`, [head.tournament_id]);
      await this.access.requireNotArchived(head.tournament_id, c);
      await this.access.requireMatchesOpen(head.tournament_id, c);
      const m = await this.db.one(
        `SELECT m.bracket_id, m.bracket_round, m.bracket_slot, m.status, m.bracket_advanced_side, mr.winner_side,
                (SELECT tournament_athlete_id FROM match_participants WHERE match_id = m.id AND side = $2) AS entry
           FROM matches m LEFT JOIN match_results mr ON mr.match_id = m.id
          WHERE m.id = $1 FOR UPDATE OF m`,
        [mid, side],
        c,
      );
      if (!m?.bracket_id) throw new AppError('VALIDATION', 'Поединок не входит в сетку');
      if (m.bracket_advanced_side) throw new AppError('CONFLICT', 'Проход из этого поединка уже определён');
      const noWinner = m.status === 'cancelled' || (m.status === 'completed' && !m.winner_side);
      if (!noWinner) throw new AppError('INVALID_TRANSITION', 'Проход назначается только для отменённого поединка или поединка без победителя');
      if (!m.entry) throw new AppError('VALIDATION', 'В этом углу нет спортсмена');

      const to = nextPosition(m.bracket_round, m.bracket_slot);
      const next = await this.db.one<{ id: string; status: string }>(
        `SELECT id, status FROM matches WHERE bracket_id = $1 AND bracket_round = $2 AND bracket_slot = $3 FOR UPDATE`,
        [m.bracket_id, to.round, to.slot],
        c,
      );
      if (next) {
        if (next.status !== 'prepared') throw new AppError('INVALID_TRANSITION', 'Следующий поединок уже начался');
        await this.db.query(`INSERT INTO match_participants (match_id, side, tournament_athlete_id) VALUES ($1, $2, $3)`, [next.id, to.side, m.entry], c);
      }
      await this.db.query(`UPDATE matches SET bracket_advanced_side = $2, updated_at = now() WHERE id = $1`, [mid, side], c);
      await this.audit.record(
        { actorUserId: user.id, action: 'bracket.walkover', entityType: 'match', entityId: mid, tournamentId: head.tournament_id, data: { side }, ip },
        c,
      );
      return { ok: true, nextMatchId: next?.id ?? null };
    });
    // After commit: judges and displays of the next match see the new participant without reloading.
    if (done.nextMatchId) this.scoring.notifyChanged(done.nextMatchId);
    return done;
  }

  /** New match with its state row; shared by single matches and brackets. */
  private async insertMatch(c: Db, tournamentId: string, disciplineId: string, userId: string, scheduledAt: string | null = null) {
    const m = await this.db.one<{ id: string; match_number: number }>(
      `INSERT INTO matches (tournament_id, discipline_id, match_number, scheduled_at, created_by)
       VALUES ($1, $2, (SELECT coalesce(max(match_number), 0) + 1 FROM matches WHERE tournament_id = $1), $3, $4)
       RETURNING id, match_number`,
      [tournamentId, disciplineId, scheduledAt, userId],
      c,
    );
    await this.db.query(`INSERT INTO match_states (match_id, score, penalties) VALUES ($1, '{"red":0,"blue":0}', '{"red":{},"blue":{}}')`, [m!.id], c);
    return m!;
  }

  private async placeInBracket(c: Db, matchId: string, bracketId: string, round: number, slot: number) {
    await this.db.query(`UPDATE matches SET bracket_id = $2, bracket_round = $3, bracket_slot = $4 WHERE id = $1`, [matchId, bracketId, round, slot], c);
  }

  private async lockPrepared(id: string, user: SessionUser) {
    const m = await this.db.one(`SELECT tournament_id, status FROM matches WHERE id = $1`, [id]);
    if (!m) throw new AppError('NOT_FOUND', 'Поединок не найден');
    await this.access.requireTournamentEdit(user.id, m.tournament_id);
    await this.access.requireMatchesOpen(m.tournament_id);
    return m;
  }

  private async applySetup(matchId: string, tournamentId: string, s: z.infer<typeof setupSchema>, userId: string, c: Db) {
    // The match discipline must be one of the tournament's (tournament edit already refuses to drop a used one).
    const inTournament = await this.db.one(`SELECT 1 FROM tournament_disciplines WHERE tournament_id = $1 AND discipline_id = $2`, [tournamentId, s.disciplineId], c);
    if (!inTournament) throw new AppError('VALIDATION', 'Дисциплина не относится к этому турниру');
    if (s.ruleVersionId) {
      const v = await this.db.one(
        `SELECT v.status, p.discipline_id, p.archived_at, p.visibility, p.created_by,
                (SELECT rule_profile_version_id FROM matches WHERE id = $2) AS current_version_id
           FROM rule_profile_versions v JOIN rule_profiles p ON p.id = v.rule_profile_id WHERE v.id = $1`,
        [s.ruleVersionId, matchId],
        c,
      );
      if (!v || v.status !== 'approved') throw new AppError('VALIDATION', 'Можно выбрать только утверждённую версию правил');
      if (v.discipline_id !== s.disciplineId) throw new AppError('VALIDATION', 'Версия правил относится к другой дисциплине');
      // A newly chosen version must come from a profile the user may use; an already bound one stays valid.
      if (v.current_version_id !== s.ruleVersionId) {
        if (v.archived_at) throw new AppError('VALIDATION', 'Профиль правил в архиве и недоступен для новых поединков');
        if (v.visibility !== 'shared' && v.created_by !== userId && !(await this.access.can(userId, 'rules.manage', null, c))) {
          throw new AppError('VALIDATION', 'Эта версия правил вам недоступна');
        }
      }
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
