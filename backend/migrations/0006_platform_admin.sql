-- Platform administrator: one account above every organizer and judge (docs/ARCHITECTURE.md §5.5).

-- The existing system role becomes the platform administrator.
UPDATE roles SET name = 'Администратор платформы' WHERE code = 'owner';

-- Blocking keeps the account and its history; deleting anonymizes it (the event log and audit keep their references,
-- history is never erased). A deleted account cannot sign in and is hidden from lists.
ALTER TABLE users
  ADD COLUMN blocked_at     timestamptz,
  ADD COLUMN blocked_reason text,
  ADD COLUMN deleted_at     timestamptz;

-- Exactly one platform administrator, enforced by the database: a second assignment of the role fails.
DO $$
DECLARE owner_id uuid;
BEGIN
  SELECT id INTO owner_id FROM roles WHERE code = 'owner';
  EXECUTE format('CREATE UNIQUE INDEX user_role_assignments_one_admin_uq ON user_role_assignments ((true)) WHERE role_id = %L', owner_id);
END $$;
