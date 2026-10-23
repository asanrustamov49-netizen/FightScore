// Shapes of API responses. Mirrors backend output; contains no rules (docs/ARCHITECTURE.md §3).

export type Side = "red" | "blue";
export type MatchStatus = "prepared" | "ready" | "live" | "awaiting_confirmation" | "completed" | "cancelled";
export type OfficialAction = "score" | "penalty" | "timer" | "period" | "correct" | "end" | "confirm";

export interface Me {
  user: { id: string; login: string; displayName: string };
  roles: { code: string; name: string; scope_type: string; tournament_id: string | null }[];
  permissions: string[];
  capabilities: { organizer: boolean; judge: boolean; displays: boolean };
  deployMode: "dev-http" | "production";
}

export interface Country {
  id: string;
  code: string;
  name: string;
}

export interface Discipline {
  id: string;
  code: string;
  name: string;
}

export interface Athlete {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  birth_year: number | null;
  country_id: string;
  country_code: string;
  country_name: string;
  club_id: string | null;
  club_name: string | null;
  updated_at: string;
  created_by: string | null;
  can_edit: boolean;
}

export interface TournamentSummary {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  venue: string | null;
  status: "draft" | "scheduled" | "active" | "completed";
  archived_at: string | null;
  athletes_count: number;
  matches_count: number;
  live_count: number;
  completed_count: number;
  disciplines: string | null;
  can_manage: boolean;
}

export interface TournamentEntry {
  id: string;
  registration_number: string | null;
  status: string;
  athlete_id: string;
  first_name: string;
  last_name: string;
  country_code: string;
  country_name: string;
  club_name: string | null;
}

export interface TournamentDetail extends Omit<TournamentSummary, "athletes_count" | "matches_count" | "live_count" | "completed_count" | "disciplines" | "can_manage"> {
  disciplines: Discipline[];
  athletes: TournamentEntry[];
  canManage: boolean;
}

export interface MatchListItem {
  id: string;
  match_number: number;
  status: MatchStatus;
  scheduled_at: string | null;
  tournament_id: string;
  tournament_name: string;
  discipline_name: string;
  score: Record<Side, number>;
  version: number;
  red_name: string | null;
  blue_name: string | null;
  winner_side: Side | null;
  is_official: boolean;
}

export interface RuleDefinition {
  periods: { count: number; durationSec: number };
  scoring: { code: string; label: string; points: number }[];
  penalties: { code: string; label: string; public: boolean; opponentPoints: number }[];
  endMethods: { code: string; label: string; requiresWinner: boolean }[];
  roles: Record<"chief_judge" | "judge", OfficialAction[]>;
  timeAdjust: { maxSec: number };
}

export interface RuleVersion {
  id: string;
  version_number: number;
  status: "draft" | "approved" | "archived";
  is_demo: boolean;
  engine: string;
  engine_version: number;
  definition: RuleDefinition;
  source_title: string | null;
  source_edition: string | null;
  effective_from: string | null;
  change_summary: string | null;
  profile_id: string;
  profile_name: string;
  profile_archived_at?: string | null;
  discipline_id: string;
  discipline_name: string;
}

export interface RuleAbilities {
  manageAll: boolean;
  create: boolean;
  approveOfficial: boolean;
}

export interface RuleVersionSummary {
  id: string;
  version_number: number;
  status: RuleVersion["status"];
  is_demo: boolean;
  effective_from: string | null;
  source_title: string | null;
  source_edition: string | null;
}

export interface RuleProfileSummary {
  id: string;
  name: string;
  description: string | null;
  visibility: "shared" | "private";
  archived_at: string | null;
  created_at: string;
  discipline_id: string;
  discipline_name: string;
  author_name: string | null;
  versions: RuleVersionSummary[];
  matches_count: number;
  can_edit: boolean;
}

export interface RuleVersionDetail {
  id: string;
  version_number: number;
  status: RuleVersion["status"];
  is_demo: boolean;
  engine: string;
  engine_version: number;
  definition: RuleDefinition;
  source_title: string | null;
  source_edition: string | null;
  source_url: string | null;
  source_published_on: string | null;
  effective_from: string | null;
  change_summary: string | null;
  created_at: string;
  approved_at: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  matches_count: number;
}

export interface RuleProfileDetail {
  id: string;
  name: string;
  description: string | null;
  visibility: "shared" | "private";
  archived_at: string | null;
  created_at: string;
  discipline_id: string;
  discipline_name: string;
  author_name: string | null;
  versions: RuleVersionDetail[];
  can_edit: boolean;
  abilities: RuleAbilities;
}

export interface Participant {
  side: Side;
  entry_id: string;
  athlete_id: string;
  first_name: string;
  last_name: string;
  country_code: string;
  country_name: string;
  club_name: string | null;
}

export interface MatchState {
  status: MatchStatus;
  periodIndex: number;
  timer: { status: "stopped" | "running"; remainingMs: number; startedAt: number | null };
  score: Record<Side, number>;
  penalties: Record<Side, Record<string, number>>;
  pendingResult: { outcomeCode: string; winnerSide: Side | null } | null;
}

export interface Clock {
  running: boolean;
  remainingMs: number;
}

export interface MatchSnapshot {
  id: string;
  matchNumber: number;
  status: MatchStatus;
  tournament: { id: string; name: string; status: TournamentSummary["status"]; archived: boolean };
  /** Set for a bracket match: its pairs are fixed by the bracket. */
  bracket: { id: string; round: number; slot: number; advancedSide: Side | null } | null;
  discipline: { id: string; name: string };
  scheduledAt: string | null;
  cancelReason: string | null;
  rules: { versionId: string; profileName: string; versionNumber: number; isDemo: boolean; definition: RuleDefinition } | null;
  participants: Partial<Record<Side, Participant>>;
  officials: { id: string; official_role: "chief_judge" | "judge"; permissions: string[]; user_id: string; display_name: string }[];
  version: number;
  serverTime: number;
  clock: Clock;
  state: MatchState;
  result: { winner_side: Side | null; outcome_code: string; confirmed_at: string; confirmed_by: string } | null;
  viewer?: { canManage: boolean; official: { role: "chief_judge" | "judge"; actions: OfficialAction[] } | null };
}

export interface MatchEvent {
  id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  actor_role: string;
  actor_name: string | null;
  reason: string | null;
  corrects_event_id: string | null;
  server_time: string;
  voided: boolean;
}

export interface PublicSide {
  name: string | null;
  countryCode: string | null;
  countryName: string | null;
  club: string | null;
  score: number;
  /** Disqualified: the score above is already 0 (the log keeps the points). */
  disqualified?: boolean;
  penalties: { code: string; label: string; count: number }[];
}

export interface PublicMatch {
  matchId: string;
  matchNumber: number;
  status: MatchStatus;
  tournamentName: string;
  disciplineName: string;
  isDemoRules: boolean;
  period: number;
  periodsCount: number | null;
  clock: Clock;
  red: PublicSide;
  blue: PublicSide;
  result: { winnerSide: Side | null; outcome: string } | null;
  version: number;
  serverTime: number;
}

export interface PublicDisplay {
  display: { id: string; name: string; tournamentName: string };
  match: PublicMatch | null;
}

export interface DisplayItem {
  id: string;
  name: string;
  public_token: string;
  current_match_id: string | null;
  tournament_id: string;
  tournament_name: string;
  match_number: number | null;
}

export interface AuthOptions {
  registration: boolean;
  minPasswordLength: number;
}

export interface OfficialCandidate {
  id: string;
  login: string;
  display_name: string;
  tournament_account: boolean;
  roles: string[];
}

export interface BracketSide {
  entry_id: string;
  first_name: string;
  last_name: string;
  country_code: string;
}

export interface BracketMatch {
  id: string;
  round: number;
  slot: number;
  match_number: number;
  status: MatchStatus;
  score: Record<Side, number>;
  /** Confirmed result. */
  winner_side: Side | null;
  /** Who went through: the confirmed winner or an organizer's walkover. */
  advanced_side: Side | null;
  sides: Partial<Record<Side, BracketSide>> | null;
}

export interface Bracket {
  id: string;
  discipline_id: string;
  discipline_name: string;
  size: number;
  format: "single_elimination";
  rule_profile_name: string;
  rule_version_number: number;
  matches: BracketMatch[];
}
