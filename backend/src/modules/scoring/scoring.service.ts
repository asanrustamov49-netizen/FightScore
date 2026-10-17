import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { parse, uuid } from '../../common/validation.js';
import { DatabaseService, type Db } from '../../database/database.service.js';
import type { SessionUser } from '../auth/auth.service.js';
import { canManageSql, MatchesService, STATE_SELECT, toEngineState, type StateRow } from '../matches/matches.service.js';
import type { RuleDefinition } from '../rules/definition.js';
import {
  ADDITIVE_COMMANDS,
  apply,
  COMMAND_ACTION,
  remainingAt,
  replay,
  RuleError,
  VOIDABLE,
  type Command,
  type MatchState,
} from '../rules/engine.js';

const side = z.enum(['red', 'blue']);
const reason = z.string().trim().min(3, 'Укажите причину').max(300);

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('match.ready') }),
  z.object({ type: z.literal('match.cancel'), reason }),
  z.object({ type: z.literal('match.start') }),
  z.object({ type: z.literal('timer.start') }),
  z.object({ type: z.literal('timer.stop') }),
  z.object({ type: z.literal('timer.set'), remainingMs: z.number().int().min(0), reason }),
  z.object({ type: z.literal('period.next') }),
  z.object({ type: z.literal('score.add'), side, code: z.string().max(40) }),
  z.object({ type: z.literal('score.subtract'), side, code: z.string().max(40) }),
  z.object({ type: z.literal('penalty.add'), side, code: z.string().max(40) }),
  z.object({ type: z.literal('event.void'), eventId: uuid, reason }),
  z.object({ type: z.literal('match.end'), outcomeCode: z.string().max(40), winnerSide: side.nullable() }),
  z.object({ type: z.literal('match.resume') }),
  z.object({ type: z.literal('result.confirm') }),
]);

export const envelopeSchema = z.object({
  commandId: uuid,
  expectedVersion: z.number().int().min(0),
  command: commandSchema,
});

export type CommandResult = { status: 'accepted' | 'duplicate'; version: number };
export interface MatchChanged {
  matchId: string;
  version: number;
}

interface ReadRow extends StateRow {
  now_ms: number;
  dup_seq: number | null;
  official_role: 'chief_judge' | 'judge' | null;
  official_permissions: string[] | null;
  can_manage: boolean;
  sides: number;
  has_chief: boolean;
}

/**
 * One round trip: current state, server time, duplicate check, actor rights and readiness facts.
 * Params: $1 match, $2 command id, $3 user id (null for system).
 */
const READ_SQL = `
  SELECT ms.match_id, ms.version, m.status, m.tournament_id, m.rule_profile_version_id, ms.period_index,
         ms.timer_status, ms.timer_remaining_ms,
         floor(extract(epoch FROM ms.timer_started_at) * 1000)::bigint AS started_ms,
         ms.score, ms.penalties, ms.pending_result,
         floor(extract(epoch FROM now()) * 1000)::bigint AS now_ms,
         (SELECT seq FROM match_events WHERE match_id = $1 AND command_id = $2) AS dup_seq,
         mo.official_role, mo.permissions AS official_permissions,
         ${canManageSql('$3', 'm.tournament_id')} AS can_manage,
         (SELECT count(*)::int FROM match_participants WHERE match_id = $1) AS sides,
         EXISTS (SELECT 1 FROM match_officials WHERE match_id = $1 AND official_role = 'chief_judge') AS has_chief
    FROM match_states ms
    JOIN matches m ON m.id = ms.match_id
    LEFT JOIN match_officials mo ON mo.match_id = ms.match_id AND mo.user_id = $3
   WHERE ms.match_id = $1`;

/**
 * One atomic statement: compare-and-swap on the state version, then the event, the match status and
 * (on confirmation) the immutable result. If the version moved, nothing is written (updated = 0).
 */
const WRITE_SQL = `
  WITH st AS (
    UPDATE match_states SET version = $2, period_index = $3, timer_status = $4, timer_remaining_ms = $5,
           timer_started_at = CASE WHEN $6::double precision IS NULL THEN NULL ELSE to_timestamp($6::double precision / 1000) END,
           score = $7, penalties = $8, pending_result = $9, updated_at = now()
     WHERE match_id = $1 AND version = $10
    RETURNING match_id
  ), ev AS (
    INSERT INTO match_events (match_id, seq, command_id, type, payload, actor_user_id, actor_role, corrects_event_id, reason, server_time)
    SELECT $1, $2, $11, $12, $13, $14, $15, $16, $17, to_timestamp($18::double precision / 1000) FROM st
    RETURNING id
  ), mt AS (
    UPDATE matches SET status = $19, cancel_reason = coalesce($20, cancel_reason), updated_at = now()
     WHERE id = $1 AND status <> $19 AND EXISTS (SELECT 1 FROM st)
    RETURNING id
  ), res AS (
    INSERT INTO match_results (match_id, winner_side, outcome_code, final_state, participants_snapshot, rule_profile_version_id, final_event_seq, confirmed_by)
    SELECT $1, $21, $22, $23,
           (SELECT coalesce(json_agg(json_build_object('side', mp.side, 'athlete_id', a.id, 'first_name', a.first_name,
                    'last_name', a.last_name, 'country_code', co.iso_alpha2, 'country_name', co.name, 'club_name', cl.name)), '[]'::json)::jsonb
              FROM match_participants mp
              JOIN tournament_athletes ta ON ta.id = mp.tournament_athlete_id
              JOIN athletes a ON a.id = ta.athlete_id
              JOIN countries co ON co.id = a.country_id
              LEFT JOIN clubs cl ON cl.id = a.club_id
             WHERE mp.match_id = $1),
           $24, $2, $14
      FROM st WHERE $25::boolean
    RETURNING match_id
  )
  SELECT (SELECT count(*) FROM st)::int AS updated, (SELECT count(*) FROM ev)::int AS events,
         (SELECT count(*) FROM mt)::int AS status_changed, (SELECT count(*) FROM res)::int AS results`;

const OPTIMISTIC_ATTEMPTS = 2;

interface Attempt {
  result: CommandResult;
  next?: MatchState;
  now?: number;
}

@Injectable()
export class ScoringService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Scoring');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Emits after the write is committed; subscribers (Realtime) never see uncommitted state. */
  readonly changes = new Subject<MatchChanged>();

  constructor(
    private readonly db: DatabaseService,
    private readonly matches: MatchesService,
  ) {}

  async onApplicationBootstrap() {
    const running = await this.db.query<StateRow>(`${STATE_SELECT} WHERE m.status = 'live' AND ms.timer_status = 'running'`);
    for (const row of running) this.schedule(row.match_id, toEngineState(row), Date.now());
    if (running.length) this.logger.log(`restored ${running.length} running timer(s)`);
  }

  onModuleDestroy() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Validates an untrusted command envelope from HTTP or WebSocket and executes it. */
  executeUntrusted(matchId: string, body: unknown, user: SessionUser) {
    return this.execute(parse(uuid, matchId), parse(envelopeSchema, body), user);
  }

  /**
   * Optimistic concurrency (docs/ARCHITECTURE.md §6.2–6.3): read, decide in the pure engine, then write
   * only if the version is unchanged — two round trips per command on a remote database. State-dependent
   * commands report VERSION_CONFLICT on a lost race. Additive and system commands retry; after
   * OPTIMISTIC_ATTEMPTS lost races they run under a row lock, so they are never dropped under contention.
   */
  async execute(
    matchId: string,
    env: { commandId: string | null; expectedVersion: number | null; command: Command },
    user: SessionUser | null,
  ): Promise<CommandResult> {
    const retryable = !user || ADDITIVE_COMMANDS.has(env.command.type);
    let outcome: Attempt | 'lost' = 'lost';
    for (let i = 0; i < OPTIMISTIC_ATTEMPTS && outcome === 'lost'; i++) {
      outcome = await this.attempt(matchId, env, user, retryable, this.db.pool);
      if (outcome === 'lost' && !retryable) throw this.versionConflict(-1);
    }
    if (outcome === 'lost') {
      outcome = await this.db.tx(async (c) => {
        await c.query(`SELECT 1 FROM match_states WHERE match_id = $1 FOR UPDATE`, [matchId]);
        return this.attempt(matchId, env, user, retryable, c);
      });
      if (outcome === 'lost') throw new AppError('CONFLICT', 'Не удалось применить команду, повторите действие');
    }
    if (outcome.result.status === 'accepted') {
      // Strictly after the write is durable: realtime subscribers never see uncommitted state.
      this.schedule(matchId, outcome.next!, outcome.now!);
      this.changes.next({ matchId, version: outcome.result.version });
    }
    return outcome.result;
  }

  /** One read–decide–write cycle on `db` (the pool, or a transaction holding the row lock). */
  private async attempt(
    matchId: string,
    env: { commandId: string | null; expectedVersion: number | null; command: Command },
    user: SessionUser | null,
    retryable: boolean,
    db: Db,
  ): Promise<Attempt | 'lost'> {
    const { command } = env;
    {
      const row = await this.db.one<ReadRow>(READ_SQL, [matchId, env.commandId, user?.id ?? null], db);
      if (!row) throw new AppError('NOT_FOUND', 'Поединок не найден');
      if (row.dup_seq !== null) return { result: { status: 'duplicate', version: row.version } };

      const def = await this.matches.definition(row.rule_profile_version_id);
      const actorRole = this.authorize(row, def, command, user);
      if (!retryable && env.expectedVersion !== row.version) throw this.versionConflict(row.version);

      const now = Number(row.now_ms);
      const next = await this.decide(row, def, command, now);
      const version = row.version + 1;
      const confirm = command.type === 'result.confirm';
      let written: { updated: number };
      try {
        written = (await this.db.one(WRITE_SQL, [
          matchId,
          version,
          next.periodIndex,
          next.timer.status,
          next.timer.remainingMs,
          next.timer.startedAt,
          next.score,
          next.penalties,
          next.pendingResult,
          row.version,
          env.commandId,
          command.type,
          { ...command, remainingMs: next.timer.status === 'stopped' ? next.timer.remainingMs : undefined },
          user?.id ?? null,
          actorRole,
          command.type === 'event.void' ? command.eventId : null,
          'reason' in command ? command.reason : null,
          now,
          next.status,
          command.type === 'match.cancel' ? command.reason : null,
          confirm ? next.pendingResult!.winnerSide : null,
          confirm ? next.pendingResult!.outcomeCode : null,
          confirm ? { score: next.score, penalties: next.penalties, periodIndex: next.periodIndex, remainingMs: next.timer.remainingMs } : null,
          row.rule_profile_version_id,
          confirm,
        ], db))!;
      } catch (err) {
        // Same commandId raced in through another connection: the unique index made it a no-op.
        if ((err as { constraint?: string }).constraint === 'match_events_command_uq') {
          return { result: { status: 'duplicate', version: row.version } };
        }
        throw err;
      }
      if (written.updated === 1) return { result: { status: 'accepted', version }, next, now };
      if (!retryable) throw this.versionConflict(row.version + 1);
      return 'lost';
    }
  }

  private versionConflict(version: number) {
    return new AppError('VERSION_CONFLICT', 'Состояние поединка изменилось. Проверьте актуальные данные и повторите действие.', { version });
  }

  /** Returns the actor role recorded in the event log, or throws FORBIDDEN. */
  private authorize(row: ReadRow, def: RuleDefinition | null, command: Command, user: SessionUser | null) {
    const needed = COMMAND_ACTION[command.type];
    if (needed === 'system') {
      if (user) throw new AppError('FORBIDDEN', 'Системное действие недоступно пользователю');
      return 'system';
    }
    if (!user) throw new AppError('FORBIDDEN', 'Требуется пользователь');
    if (needed === 'organizer') {
      if (!row.can_manage) throw new AppError('FORBIDDEN', 'Недостаточно прав для этого действия', { permission: 'tournament.manage' });
      return 'organizer';
    }
    if (!row.official_role) throw new AppError('FORBIDDEN', 'Вы не назначены судьёй этого поединка');
    const actions = this.matches.actionsFor(def, row.official_role, row.official_permissions ?? []);
    if (!actions.includes(needed)) {
      throw new AppError('FORBIDDEN', 'Профиль правил не разрешает это действие вашей судейской роли', { action: needed });
    }
    return row.official_role;
  }

  /** Runs the pure engine; maps rule errors to API errors. */
  private async decide(row: ReadRow, def: RuleDefinition | null, command: Command, now: number): Promise<MatchState> {
    const current = toEngineState(row);
    try {
      if (command.type === 'match.ready') {
        const problems = [
          row.sides < 2 && 'назначьте спортсменов обеих сторон',
          !row.has_chief && 'назначьте главного судью',
          !row.rule_profile_version_id && 'выберите версию правил',
        ].filter(Boolean);
        if (problems.length) throw new RuleError('RULE_VIOLATION', `Поединок не готов: ${problems.join(', ')}`);
        return apply(def ?? ({} as RuleDefinition), current, command, now);
      }
      if (command.type === 'match.cancel') return apply(def ?? ({} as RuleDefinition), current, command, now);
      if (!def) throw new RuleError('RULE_VIOLATION', 'Поединку не назначена версия правил');
      if (command.type === 'event.void') return await this.replayWithVoid(row.match_id, def, command, now);
      return apply(def, current, command, now);
    } catch (err) {
      if (err instanceof RuleError) throw new AppError(err.code, err.message);
      throw err;
    }
  }

  private async replayWithVoid(matchId: string, def: RuleDefinition, command: Extract<Command, { type: 'event.void' }>, now: number) {
    const events = await this.db.query(
      `SELECT id, type, payload, floor(extract(epoch FROM server_time) * 1000)::bigint AS at,
              EXISTS (SELECT 1 FROM match_events v WHERE v.corrects_event_id = e.id) AS voided
         FROM match_events e WHERE match_id = $1 ORDER BY seq`,
      [matchId],
    );
    const target = events.find((e) => e.id === command.eventId);
    if (!target) throw new RuleError('RULE_VIOLATION', 'Событие не найдено в журнале этого поединка');
    if (!VOIDABLE.has(target.type)) throw new RuleError('RULE_VIOLATION', 'Отменять можно только начисление, снятие баллов и нарушения');
    if (target.voided) throw new RuleError('RULE_VIOLATION', 'Событие уже отменено');
    const log = events.map((e) => ({ id: e.id, command: { ...e.payload, type: e.type } as Command, at: Number(e.at) }));
    log.push({ id: 'pending', command, at: now });
    try {
      return replay(def, log);
    } catch (err) {
      if (err instanceof RuleError) {
        throw new RuleError('RULE_VIOLATION', `Отмена невозможна: последующие события от неё зависят (${err.message})`);
      }
      throw err;
    }
  }

  /** In-memory expiry timer; the state itself is always in PostgreSQL (docs/ARCHITECTURE.md §6.5). */
  private schedule(matchId: string, state: MatchState, now: number) {
    const existing = this.timers.get(matchId);
    if (existing) clearTimeout(existing);
    this.timers.delete(matchId);
    if (state.status !== 'live' || state.timer.status !== 'running' || state.timer.startedAt === null) return;
    const delay = Math.max(50, remainingAt(state.timer, now) + 20);
    const handle = setTimeout(() => void this.expire(matchId), delay);
    handle.unref();
    this.timers.set(matchId, handle);
  }

  private async expire(matchId: string) {
    this.timers.delete(matchId);
    try {
      await this.execute(matchId, { commandId: null, expectedVersion: null, command: { type: 'timer.expire' } }, null);
    } catch (err) {
      if (err instanceof AppError && err.code === 'INVALID_TRANSITION') {
        // Not yet expired by database time, or already stopped: reschedule from the stored state.
        const row = await this.db.one<StateRow & { now_ms: number }>(
          `${STATE_SELECT.replace('SELECT ', 'SELECT floor(extract(epoch FROM now()) * 1000)::bigint AS now_ms, ')} WHERE ms.match_id = $1`,
          [matchId],
        );
        if (row) this.schedule(matchId, toEngineState(row), Number(row.now_ms));
        return;
      }
      this.logger.error(`timer expiry failed for ${matchId}: ${(err as Error).message}`);
    }
  }
}
