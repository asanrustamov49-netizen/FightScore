import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { DatabaseService, type Db } from '../../database/database.service.js';
import { definitionSchema, isDisqualification, withDisqualification, type OfficialAction, type RuleDefinition } from '../rules/definition.js';
import { remainingAt, type MatchState, type MatchStatus, type Side } from '../rules/engine.js';

export interface StateRow {
  match_id: string;
  version: number;
  status: MatchStatus;
  tournament_id: string;
  rule_profile_version_id: string | null;
  period_index: number;
  timer_status: 'stopped' | 'running';
  timer_remaining_ms: number;
  started_ms: number | null;
  score: Record<Side, number>;
  penalties: Record<Side, Record<string, number>>;
  pending_result: MatchState['pendingResult'];
}

export const STATE_SELECT = `
  SELECT ms.match_id, ms.version, m.status, m.tournament_id, m.rule_profile_version_id, ms.period_index,
         ms.timer_status, ms.timer_remaining_ms,
         floor(extract(epoch FROM ms.timer_started_at) * 1000)::bigint AS started_ms,
         ms.score, ms.penalties, ms.pending_result
    FROM match_states ms JOIN matches m ON m.id = ms.match_id`;

export function toEngineState(r: StateRow): MatchState {
  return {
    status: r.status,
    periodIndex: r.period_index,
    timer: { status: r.timer_status, remainingMs: r.timer_remaining_ms, startedAt: r.started_ms },
    score: r.score,
    penalties: r.penalties,
    pendingResult: r.pending_result,
  };
}

/** SQL boolean: may `userExpr` manage the tournament `tournamentExpr` (system or tournament-scope grant)? */
export function canManageSql(userExpr: string, tournamentExpr: string) {
  return `EXISTS (SELECT 1 FROM user_role_assignments ura
    JOIN role_permissions rp ON rp.role_id = ura.role_id AND rp.permission = 'tournament.manage'
    JOIN users u ON u.id = ura.user_id AND u.is_active
   WHERE ura.user_id = ${userExpr} AND (ura.scope_type = 'system' OR ura.tournament_id = ${tournamentExpr}))`;
}

export interface Viewer {
  canManage: boolean;
  official: { role: 'chief_judge' | 'judge'; actions: OfficialAction[] } | null;
}

@Injectable()
export class MatchesService {
  constructor(private readonly db: DatabaseService) {}

  /** Approved rule versions are immutable (DB trigger), so parsed definitions are cached for good. */
  private readonly definitions = new Map<string, RuleDefinition>();

  parseDefinition(versionId: string, raw: unknown): RuleDefinition {
    let def = this.definitions.get(versionId);
    if (!def) {
      def = withDisqualification(definitionSchema.parse(raw));
      this.definitions.set(versionId, def);
    }
    return def;
  }

  async definition(versionId: string | null, db?: Db): Promise<RuleDefinition | null> {
    if (!versionId) return null;
    const cached = this.definitions.get(versionId);
    if (cached) return cached;
    const row = await this.db.one(`SELECT definition FROM rule_profile_versions WHERE id = $1`, [versionId], db);
    return row ? this.parseDefinition(versionId, row.definition) : null;
  }

  actionsFor(def: RuleDefinition | null, role: 'chief_judge' | 'judge', permissions: string[]): OfficialAction[] {
    if (!def) return [];
    const byProfile = def.roles[role];
    return permissions.length ? byProfile.filter((a) => permissions.includes(a)) : byProfile;
  }

  async viewer(userId: string, matchId: string, tournamentId: string, def: RuleDefinition | null, db?: Db): Promise<Viewer> {
    const row = await this.db.one(
      `SELECT ${canManageSql('$1', '$3')} AS can_manage,
              (SELECT official_role FROM match_officials WHERE match_id = $2 AND user_id = $1) AS official_role,
              (SELECT permissions FROM match_officials WHERE match_id = $2 AND user_id = $1) AS permissions`,
      [userId, matchId, tournamentId],
      db,
    );
    const official = row!.official_role
      ? { role: row!.official_role as 'chief_judge' | 'judge', actions: this.actionsFor(def, row!.official_role, row!.permissions) }
      : null;
    return { canManage: row!.can_manage, official };
  }

  /** Organizer of the tournament or an official of the match; one round trip. */
  async requireView(userId: string, matchId: string): Promise<{ tournamentId: string }> {
    const m = await this.db.one(
      `SELECT m.tournament_id, ${canManageSql('$1', 'm.tournament_id')} AS can_manage,
              EXISTS (SELECT 1 FROM match_officials mo WHERE mo.match_id = m.id AND mo.user_id = $1) AS is_official
         FROM matches m WHERE m.id = $2`,
      [userId, matchId],
    );
    if (!m) throw new AppError('NOT_FOUND', 'Поединок не найден');
    if (!m.can_manage && !m.is_official) throw new AppError('FORBIDDEN', 'Нет доступа к этому поединку');
    return { tournamentId: m.tournament_id };
  }

  /** Full match snapshot for organizers and officials, in one round trip. Times are relative to `serverTime`. */
  async snapshot(matchId: string, db?: Db) {
    const m = await this.db.one(
      `SELECT m.id, m.match_number, m.status, m.tournament_id, m.scheduled_at, m.cancel_reason,
              t.name AS tournament_name, t.status AS tournament_status, (t.archived_at IS NOT NULL) AS tournament_archived,
              m.bracket_id, m.bracket_round, m.bracket_slot, m.bracket_advanced_side,
              d.id AS discipline_id, d.name AS discipline_name,
              rpv.id AS rule_version_id, rpv.version_number AS rule_version_number, rpv.is_demo, rp.name AS rule_profile_name,
              rpv.definition, floor(extract(epoch FROM now()) * 1000)::bigint AS server_time,
              ms.version, ms.period_index, ms.timer_status, ms.timer_remaining_ms,
              floor(extract(epoch FROM ms.timer_started_at) * 1000)::bigint AS started_ms,
              ms.score, ms.penalties, ms.pending_result,
              (SELECT coalesce(json_agg(json_build_object(
                  'side', mp.side, 'entry_id', ta.id, 'athlete_id', a.id, 'first_name', a.first_name, 'last_name', a.last_name,
                  'country_code', c.iso_alpha2, 'country_name', c.name, 'club_name', cl.name)), '[]'::json)
                 FROM match_participants mp
                 JOIN tournament_athletes ta ON ta.id = mp.tournament_athlete_id
                 JOIN athletes a ON a.id = ta.athlete_id
                 JOIN countries c ON c.id = a.country_id
                 LEFT JOIN clubs cl ON cl.id = a.club_id
                WHERE mp.match_id = m.id) AS participants,
              (SELECT coalesce(json_agg(json_build_object(
                  'id', mo.id, 'official_role', mo.official_role, 'permissions', mo.permissions, 'user_id', u.id, 'display_name', u.display_name)
                  ORDER BY mo.official_role, u.display_name), '[]'::json)
                 FROM match_officials mo JOIN users u ON u.id = mo.user_id WHERE mo.match_id = m.id) AS officials,
              (SELECT json_build_object('winner_side', mr.winner_side, 'outcome_code', mr.outcome_code,
                                        'confirmed_at', mr.confirmed_at, 'confirmed_by', u.display_name)
                 FROM match_results mr JOIN users u ON u.id = mr.confirmed_by WHERE mr.match_id = m.id) AS result
         FROM matches m
         JOIN match_states ms ON ms.match_id = m.id
         JOIN tournaments t ON t.id = m.tournament_id
         JOIN disciplines d ON d.id = m.discipline_id
         LEFT JOIN rule_profile_versions rpv ON rpv.id = m.rule_profile_version_id
         LEFT JOIN rule_profiles rp ON rp.id = rpv.rule_profile_id
        WHERE m.id = $1`,
      [matchId],
      db,
    );
    if (!m) throw new AppError('NOT_FOUND', 'Поединок не найден');
    const { participants, officials, result } = m;
    const state = { ...m, match_id: m.id } as StateRow;
    const definition = m.definition ? this.parseDefinition(m.rule_version_id, m.definition) : null;
    const st = toEngineState(state);
    return {
      id: m.id,
      matchNumber: m.match_number,
      status: m.status as MatchStatus,
      tournament: { id: m.tournament_id, name: m.tournament_name, status: m.tournament_status, archived: m.tournament_archived },
      // Bracket position: pairs are fixed by the bracket, the winner moves on by the server (matches/bracket.ts).
      bracket: m.bracket_id ? { id: m.bracket_id, round: m.bracket_round, slot: m.bracket_slot, advancedSide: m.bracket_advanced_side } : null,
      discipline: { id: m.discipline_id, name: m.discipline_name },
      scheduledAt: m.scheduled_at,
      cancelReason: m.cancel_reason,
      rules: m.rule_version_id
        ? { versionId: m.rule_version_id, profileName: m.rule_profile_name, versionNumber: m.rule_version_number, isDemo: m.is_demo, definition }
        : null,
      participants: Object.fromEntries(participants.map((p: { side: Side }) => [p.side, p])) as Record<Side, any>,
      officials,
      version: state.version,
      serverTime: m.server_time as number,
      // Remaining time as of serverTime; clients count down from here using their clock offset.
      clock: { running: st.timer.status === 'running', remainingMs: remainingAt(st.timer, m.server_time) },
      state: st,
      result: result ?? null,
    };
  }

  /** What a TV display may show: no officials, no internal ids beyond the match, public penalties only. */
  publicView(snap: Awaited<ReturnType<MatchesService['snapshot']>>) {
    const def = snap.rules?.definition;
    const publicPenalties = new Set(def?.penalties.filter((p) => p.public).map((p) => p.code));
    const side = (s: Side) => {
      const p = snap.participants[s];
      return {
        name: p ? `${p.last_name} ${p.first_name}` : null,
        countryCode: p?.country_code ?? null,
        countryName: p?.country_name ?? null,
        club: p?.club_name ?? null,
        // A disqualified athlete's points no longer count: the board shows 0 (the log keeps every scored point).
        score: disqualified === s ? 0 : snap.state.score[s],
        disqualified: disqualified === s,
        penalties: (def?.penalties ?? [])
          .filter((d) => publicPenalties.has(d.code) && (snap.state.penalties[s][d.code] ?? 0) > 0)
          .map((d) => ({ code: d.code, label: d.label, count: snap.state.penalties[s][d.code] })),
      };
    };
    const end = def?.endMethods.find((e) => e.code === snap.result?.outcome_code);
    // Disqualified corner, from the pending result as soon as the judge ends the match, or from the confirmed one.
    const outcome =
      snap.status === 'completed'
        ? snap.result && { code: snap.result.outcome_code, winner: snap.result.winner_side }
        : snap.state.pendingResult && { code: snap.state.pendingResult.outcomeCode, winner: snap.state.pendingResult.winnerSide };
    const dqMethod = outcome && def?.endMethods.find((e) => e.code === outcome.code);
    const disqualified: Side | null = dqMethod && isDisqualification(dqMethod) && outcome.winner ? (outcome.winner === 'red' ? 'blue' : 'red') : null;
    return {
      matchId: snap.id,
      matchNumber: snap.matchNumber,
      status: snap.status,
      tournamentName: snap.tournament.name,
      disciplineName: snap.discipline.name,
      isDemoRules: snap.rules?.isDemo ?? false,
      period: snap.state.periodIndex,
      periodsCount: def?.periods.count ?? null,
      // Before the start the state holds no time yet; show the first period's length from the profile.
      clock:
        (snap.status === 'prepared' || snap.status === 'ready') && def
          ? { running: false, remainingMs: def.periods.durationSec * 1000 }
          : snap.clock,
      red: side('red'),
      blue: side('blue'),
      result: snap.status === 'completed' && snap.result ? { winnerSide: snap.result.winner_side, outcome: end?.label ?? snap.result.outcome_code } : null,
      version: snap.version,
      serverTime: snap.serverTime,
    };
  }
}
