-- Rule profile editing in the UI (docs/ARCHITECTURE.md §19).
-- Versions stay immutable after approval (rule_version_guard); only drafts are edited.

ALTER TABLE rule_profiles ADD COLUMN description text;

-- shared: visible to everyone (seeded and admin profiles); private: only to the author and rule managers.
ALTER TABLE rule_profiles ADD COLUMN visibility text NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'private'));

-- Organizers manage non-official profiles; self-registered organizers create their own private ones.
-- Approving an official regulation (is_demo = false) still needs rules.approve, held only by the owner.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
  FROM roles r
  JOIN (VALUES ('organizer', 'rules.manage'), ('organizer_self', 'rules.create')) AS p(role_code, permission) ON p.role_code = r.code
ON CONFLICT DO NOTHING;
