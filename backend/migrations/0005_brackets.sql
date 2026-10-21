-- Tournament brackets, single elimination (docs/ARCHITECTURE.md §20).
-- Additive only: a new table and nullable columns on matches; existing matches and data are untouched.
-- A bracket is one per tournament discipline. Its matches are ordinary matches that also carry their position
-- (round, slot); the winner of (round r, slot s) goes to (round r + 1, slot s / 2), red side for an even slot.

CREATE TABLE brackets (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id           uuid NOT NULL REFERENCES tournaments(id),
  discipline_id           uuid NOT NULL,
  rule_profile_version_id uuid NOT NULL REFERENCES rule_profile_versions(id),
  format                  text NOT NULL DEFAULT 'single_elimination' CHECK (format IN ('single_elimination')),
  size                    integer NOT NULL CHECK (size IN (2, 4, 8, 16, 32, 64)),
  created_by              uuid NOT NULL REFERENCES users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, discipline_id),
  -- Target of the matches FK below: a bracket match belongs to the bracket's tournament.
  UNIQUE (id, tournament_id),
  FOREIGN KEY (tournament_id, discipline_id) REFERENCES tournament_disciplines (tournament_id, discipline_id)
);

ALTER TABLE matches
  ADD COLUMN bracket_id uuid,
  ADD COLUMN bracket_round integer CHECK (bracket_round >= 1),
  ADD COLUMN bracket_slot integer CHECK (bracket_slot >= 0),
  -- Side that went through to the next round: set once, from the confirmed result or an organizer's walkover.
  ADD COLUMN bracket_advanced_side text CHECK (bracket_advanced_side IN ('red', 'blue')),
  ADD CONSTRAINT matches_bracket_position CHECK (
    (bracket_id IS NULL AND bracket_round IS NULL AND bracket_slot IS NULL)
    OR (bracket_id IS NOT NULL AND bracket_round IS NOT NULL AND bracket_slot IS NOT NULL)
  ),
  ADD CONSTRAINT matches_bracket_slot_unique UNIQUE (bracket_id, bracket_round, bracket_slot),
  -- A match can only sit in a bracket of its own tournament (NULL bracket_id: ordinary match, not checked).
  ADD CONSTRAINT matches_bracket_fk FOREIGN KEY (bracket_id, tournament_id) REFERENCES brackets (id, tournament_id),
  -- Advancement is a bracket notion only.
  ADD CONSTRAINT matches_bracket_advance CHECK (bracket_advanced_side IS NULL OR bracket_id IS NOT NULL);

CREATE INDEX matches_bracket_idx ON matches (bracket_id) WHERE bracket_id IS NOT NULL;
