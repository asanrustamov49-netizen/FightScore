-- Self-service organizers (docs/ARCHITECTURE.md §17).
-- A self-registered user gets only the right to create tournaments and athletes; every tournament
-- they create grants them the organizer role scoped to that tournament, so other tournaments stay invisible.

INSERT INTO roles (code, name) VALUES ('organizer_self', 'Организатор (самостоятельная регистрация)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission FROM roles r
CROSS JOIN (VALUES ('tournament.create'), ('athlete.create')) AS p(permission)
WHERE r.code = 'organizer_self'
ON CONFLICT DO NOTHING;

-- Who added an athlete: users without system-wide athlete.manage see and edit only their own entries
-- and athletes registered in tournaments they can see.
ALTER TABLE athletes ADD COLUMN created_by uuid REFERENCES users(id);
CREATE INDEX athletes_created_by_ix ON athletes (created_by);
