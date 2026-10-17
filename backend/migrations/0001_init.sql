-- FightScore MVP schema. Subset of docs/DATABASE.md; deviations are listed in docs/ARCHITECTURE.md §16.

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

-- Users, sessions, access ------------------------------------------------------

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login         text NOT NULL,
  display_name  text NOT NULL,
  password_hash text,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_login_uq ON users (lower(login));

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip           inet,
  user_agent   text
);
CREATE INDEX sessions_user_ix ON sessions (user_id);
CREATE INDEX sessions_expires_ix ON sessions (expires_at);

CREATE TABLE roles (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code      text NOT NULL UNIQUE,
  name      text NOT NULL,
  is_system boolean NOT NULL DEFAULT true
);

CREATE TABLE role_permissions (
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission text NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id),
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     uuid,
  tournament_id uuid,
  data          jsonb NOT NULL DEFAULT '{}',
  ip            inet
);
CREATE INDEX audit_log_time_ix ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_entity_ix ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_tournament_ix ON audit_log (tournament_id, occurred_at DESC);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Reference data -----------------------------------------------------------------

CREATE TABLE countries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iso_alpha2  char(2) NOT NULL UNIQUE CHECK (iso_alpha2 ~ '^[A-Z]{2}$'),
  iso_alpha3  char(3) UNIQUE,
  name        text NOT NULL,
  archived_at timestamptz
);

CREATE TABLE clubs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  country_id  uuid REFERENCES countries(id),
  city        text,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clubs_name_country_uq ON clubs (lower(name), country_id) NULLS NOT DISTINCT;

CREATE TABLE disciplines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  archived_at timestamptz
);

CREATE TABLE athletes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name  text NOT NULL CHECK (length(trim(first_name)) > 0),
  last_name   text NOT NULL CHECK (length(trim(last_name)) > 0),
  birth_date  date,
  birth_year  smallint CHECK (birth_year BETWEEN 1900 AND 2100),
  country_id  uuid NOT NULL REFERENCES countries(id),
  club_id     uuid REFERENCES clubs(id),
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (birth_date IS NULL OR birth_year IS NULL OR birth_year = extract(year FROM birth_date))
);
CREATE INDEX athletes_name_ix ON athletes (lower(last_name), lower(first_name));
CREATE INDEX athletes_country_ix ON athletes (country_id);

-- Tournaments ----------------------------------------------------------------------

CREATE TABLE tournaments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(trim(name)) > 0),
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  venue       text,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'active', 'completed')),
  archived_at timestamptz,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX tournaments_status_ix ON tournaments (status) WHERE archived_at IS NULL;
CREATE INDEX tournaments_starts_ix ON tournaments (starts_on);

CREATE TABLE user_role_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  role_id       uuid NOT NULL REFERENCES roles(id),
  scope_type    text NOT NULL CHECK (scope_type IN ('system', 'tournament')),
  tournament_id uuid REFERENCES tournaments(id),
  granted_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope_type = 'system') = (tournament_id IS NULL))
);
CREATE UNIQUE INDEX user_role_assignments_uq ON user_role_assignments (user_id, role_id, tournament_id) NULLS NOT DISTINCT;
CREATE INDEX user_role_assignments_tournament_ix ON user_role_assignments (tournament_id);

CREATE TABLE tournament_disciplines (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  discipline_id uuid NOT NULL REFERENCES disciplines(id),
  PRIMARY KEY (tournament_id, discipline_id)
);

CREATE TABLE tournament_athletes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id       uuid NOT NULL REFERENCES tournaments(id),
  athlete_id          uuid NOT NULL REFERENCES athletes(id),
  registration_number text,
  status              text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'withdrawn', 'disqualified')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, athlete_id),
  UNIQUE (tournament_id, registration_number)
);

-- Rules --------------------------------------------------------------------------------

CREATE TABLE rule_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discipline_id uuid NOT NULL REFERENCES disciplines(id),
  code          text NOT NULL,
  name          text NOT NULL,
  archived_at   timestamptz,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (discipline_id, code)
);

CREATE TABLE rule_profile_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_profile_id     uuid NOT NULL REFERENCES rule_profiles(id),
  version_number      integer NOT NULL CHECK (version_number > 0),
  status              text NOT NULL CHECK (status IN ('draft', 'approved', 'archived')),
  is_demo             boolean NOT NULL,
  engine              text NOT NULL,
  engine_version      integer NOT NULL,
  definition          jsonb NOT NULL,
  definition_sha256   bytea NOT NULL,
  source_title        text,
  source_edition      text,
  source_url          text,
  source_published_on date,
  effective_from      date,
  change_summary      text,
  created_by          uuid REFERENCES users(id),
  approved_by         uuid REFERENCES users(id),
  approved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_profile_id, version_number),
  CHECK (status = 'draft' OR (approved_at IS NOT NULL AND effective_from IS NOT NULL)),
  CHECK (is_demo OR status = 'draft' OR (approved_by IS NOT NULL AND source_title IS NOT NULL AND source_edition IS NOT NULL))
);
CREATE INDEX rule_profile_versions_profile_ix ON rule_profile_versions (rule_profile_id, status);

CREATE FUNCTION rule_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'approved rule version % cannot be deleted', OLD.id; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' THEN
    IF NOT (OLD.status = 'approved' AND NEW.status = 'archived'
            AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status')) THEN
      RAISE EXCEPTION 'rule version % is immutable after approval', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rule_profile_versions_guard BEFORE UPDATE OR DELETE ON rule_profile_versions
  FOR EACH ROW EXECUTE FUNCTION rule_version_guard();

-- Matches --------------------------------------------------------------------------------

CREATE TABLE matches (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id           uuid NOT NULL REFERENCES tournaments(id),
  discipline_id           uuid NOT NULL,
  rule_profile_version_id uuid REFERENCES rule_profile_versions(id),
  match_number            integer NOT NULL CHECK (match_number > 0),
  status                  text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'ready', 'live', 'awaiting_confirmation', 'completed', 'cancelled')),
  scheduled_at            timestamptz,
  cancel_reason           text,
  created_by              uuid NOT NULL REFERENCES users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, match_number),
  FOREIGN KEY (tournament_id, discipline_id) REFERENCES tournament_disciplines (tournament_id, discipline_id),
  CHECK (status IN ('prepared', 'cancelled') OR rule_profile_version_id IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL)
);
CREATE INDEX matches_tournament_status_ix ON matches (tournament_id, status);

CREATE FUNCTION match_setup_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'prepared' AND (NEW.rule_profile_version_id IS DISTINCT FROM OLD.rule_profile_version_id
      OR NEW.tournament_id <> OLD.tournament_id OR NEW.discipline_id <> OLD.discipline_id) THEN
    RAISE EXCEPTION 'match % setup is locked after leaving prepared', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER matches_setup_guard BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION match_setup_guard();

CREATE TABLE match_participants (
  match_id              uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  side                  text NOT NULL CHECK (side IN ('red', 'blue')),
  tournament_athlete_id uuid NOT NULL REFERENCES tournament_athletes(id),
  PRIMARY KEY (match_id, side),
  UNIQUE (match_id, tournament_athlete_id)
);

CREATE TABLE match_officials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  official_role text NOT NULL CHECK (official_role IN ('chief_judge', 'judge')),
  permissions   text[] NOT NULL DEFAULT '{}',
  assigned_by   uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, user_id)
);
CREATE UNIQUE INDEX match_officials_one_chief_uq ON match_officials (match_id) WHERE official_role = 'chief_judge';
CREATE INDEX match_officials_user_ix ON match_officials (user_id);

CREATE TABLE match_states (
  match_id           uuid PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  version            bigint NOT NULL DEFAULT 0,
  period_index       integer NOT NULL DEFAULT 0,
  phase              text,
  timer_status       text NOT NULL DEFAULT 'stopped' CHECK (timer_status IN ('stopped', 'running')),
  timer_remaining_ms integer NOT NULL DEFAULT 0 CHECK (timer_remaining_ms >= 0),
  timer_started_at   timestamptz,
  score              jsonb NOT NULL DEFAULT '{}',
  penalties          jsonb NOT NULL DEFAULT '{}',
  pending_result     jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((timer_status = 'running') = (timer_started_at IS NOT NULL))
);

CREATE TABLE match_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          uuid NOT NULL REFERENCES matches(id),
  seq               bigint NOT NULL,
  command_id        uuid,
  type              text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}',
  actor_user_id     uuid REFERENCES users(id),
  actor_role        text NOT NULL,
  corrects_event_id uuid REFERENCES match_events(id),
  reason            text,
  server_time       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_events_seq_uq UNIQUE (match_id, seq),
  CONSTRAINT match_events_command_uq UNIQUE (match_id, command_id),
  CONSTRAINT match_events_reason_ck CHECK (corrects_event_id IS NULL OR reason IS NOT NULL)
);
CREATE TRIGGER match_events_append_only BEFORE UPDATE OR DELETE ON match_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE match_results (
  match_id                uuid PRIMARY KEY REFERENCES matches(id),
  winner_side             text CHECK (winner_side IN ('red', 'blue')),
  outcome_code            text NOT NULL,
  final_state             jsonb NOT NULL,
  participants_snapshot   jsonb NOT NULL,
  rule_profile_version_id uuid NOT NULL REFERENCES rule_profile_versions(id),
  final_event_seq         bigint NOT NULL,
  confirmed_by            uuid NOT NULL REFERENCES users(id),
  confirmed_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER match_results_append_only BEFORE UPDATE OR DELETE ON match_results
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE displays (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id    uuid NOT NULL REFERENCES tournaments(id),
  name             text NOT NULL,
  public_token     text NOT NULL UNIQUE,
  current_match_id uuid REFERENCES matches(id),
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX displays_tournament_ix ON displays (tournament_id);

-- Seed: roles, permissions, disciplines, countries -------------------------------------------

INSERT INTO roles (code, name) VALUES
  ('owner', 'Владелец системы'),
  ('organizer', 'Организатор'),
  ('chief_judge', 'Главный судья'),
  ('judge', 'Судья'),
  ('display_operator', 'Оператор табло');

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
JOIN (VALUES
  ('owner', 'system.manage'), ('owner', 'user.manage'), ('owner', 'tournament.manage'), ('owner', 'athlete.manage'),
  ('owner', 'rules.manage'), ('owner', 'rules.approve'), ('owner', 'display.operate'), ('owner', 'audit.read'),
  ('owner', 'match.officiate'),
  ('organizer', 'tournament.manage'), ('organizer', 'athlete.manage'), ('organizer', 'display.operate'),
  ('organizer', 'audit.read'),
  ('chief_judge', 'match.officiate'),
  ('judge', 'match.officiate'),
  ('display_operator', 'display.operate')
) AS p(role, permission) ON p.role = r.code;

-- Discipline names only: no sports rules are implied by this list (PROJECT_SPEC §10).
INSERT INTO disciplines (code, name) VALUES
  ('mma', 'MMA'), ('sambo', 'Самбо'), ('bjj', 'Бразильское джиу-джитсу'), ('wrestling', 'Борьба'), ('boxing', 'Бокс');

INSERT INTO countries (iso_alpha2, iso_alpha3, name) VALUES
  ('AM', 'ARM', 'Армения'), ('AZ', 'AZE', 'Азербайджан'), ('BY', 'BLR', 'Беларусь'), ('BR', 'BRA', 'Бразилия'),
  ('GB', 'GBR', 'Великобритания'), ('DE', 'DEU', 'Германия'), ('GE', 'GEO', 'Грузия'), ('IL', 'ISR', 'Израиль'),
  ('IN', 'IND', 'Индия'), ('IR', 'IRN', 'Иран'), ('ES', 'ESP', 'Испания'), ('IT', 'ITA', 'Италия'),
  ('KZ', 'KAZ', 'Казахстан'), ('CA', 'CAN', 'Канада'), ('CN', 'CHN', 'Китай'), ('KG', 'KGZ', 'Киргизия'),
  ('KR', 'KOR', 'Республика Корея'), ('LT', 'LTU', 'Литва'), ('MX', 'MEX', 'Мексика'), ('MD', 'MDA', 'Молдова'),
  ('MN', 'MNG', 'Монголия'), ('NL', 'NLD', 'Нидерланды'), ('AE', 'ARE', 'ОАЭ'), ('PL', 'POL', 'Польша'),
  ('PT', 'PRT', 'Португалия'), ('RU', 'RUS', 'Россия'), ('RS', 'SRB', 'Сербия'), ('US', 'USA', 'США'),
  ('TJ', 'TJK', 'Таджикистан'), ('TR', 'TUR', 'Турция'), ('TM', 'TKM', 'Туркменистан'), ('UZ', 'UZB', 'Узбекистан'),
  ('UA', 'UKR', 'Украина'), ('FR', 'FRA', 'Франция'), ('JP', 'JPN', 'Япония'), ('AU', 'AUS', 'Австралия'),
  ('BG', 'BGR', 'Болгария'), ('CU', 'CUB', 'Куба'), ('FI', 'FIN', 'Финляндия'), ('SE', 'SWE', 'Швеция');
