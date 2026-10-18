import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { DatabaseService, type Db } from '../../database/database.service.js';

export type Permission =
  | 'system.manage'
  | 'user.manage'
  | 'tournament.manage'
  | 'athlete.manage'
  | 'rules.manage'
  | 'rules.create'
  | 'rules.approve'
  | 'display.operate'
  | 'audit.read'
  | 'match.officiate'
  | 'tournament.create'
  | 'athlete.create';

export interface Grant {
  permission: Permission;
  scope_type: 'system' | 'tournament';
  tournament_id: string | null;
}

@Injectable()
export class AccessService {
  constructor(private readonly db: DatabaseService) {}

  grants(userId: string, db?: Db): Promise<Grant[]> {
    return this.db.query<Grant>(
      `SELECT DISTINCT rp.permission, ura.scope_type, ura.tournament_id
         FROM user_role_assignments ura
         JOIN role_permissions rp ON rp.role_id = ura.role_id
         JOIN users u ON u.id = ura.user_id AND u.is_active
        WHERE ura.user_id = $1`,
      [userId],
      db,
    );
  }

  roles(userId: string) {
    return this.db.query<{ code: string; name: string; scope_type: string; tournament_id: string | null }>(
      `SELECT r.code, r.name, ura.scope_type, ura.tournament_id
         FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id
        WHERE ura.user_id = $1 ORDER BY r.code`,
      [userId],
    );
  }

  /** A system-scope grant covers every tournament; a tournament grant covers only that tournament. */
  async can(userId: string, permission: Permission, tournamentId?: string | null, db?: Db): Promise<boolean> {
    const grants = await this.grants(userId, db);
    return grants.some(
      (g) =>
        g.permission === permission &&
        (g.scope_type === 'system' || (tournamentId != null && g.tournament_id === tournamentId)),
    );
  }

  async canAny(userId: string, permissions: Permission[], tournamentId?: string | null, db?: Db): Promise<boolean> {
    for (const p of permissions) if (await this.can(userId, p, tournamentId, db)) return true;
    return false;
  }

  async require(userId: string, permission: Permission, tournamentId?: string | null, db?: Db) {
    if (!(await this.can(userId, permission, tournamentId, db))) {
      throw new AppError('FORBIDDEN', 'Недостаточно прав для этого действия', { permission });
    }
  }

  async officiatesAnyMatch(userId: string): Promise<boolean> {
    return !!(await this.db.one(`SELECT 1 FROM match_officials WHERE user_id = $1 LIMIT 1`, [userId]));
  }

  /** Tournament ids the user may see; `null` means all (system-scope grant). */
  /** One round trip: system-wide visibility, tournament-scoped grants and officiated tournaments. */
  async visibleTournamentIds(userId: string): Promise<string[] | null> {
    // Admin-assigned system grants reveal every tournament; self-service rights (tournament.create) do not.
    const global: Permission[] = ['tournament.manage', 'display.operate', 'audit.read'];
    const row = await this.db.one<{ all_visible: boolean | null; scoped: string[]; officiated: string[] }>(
      `SELECT bool_or(ura.scope_type = 'system' AND rp.permission = ANY($2)) AS all_visible,
              coalesce(array_agg(DISTINCT ura.tournament_id) FILTER (WHERE ura.tournament_id IS NOT NULL), '{}') AS scoped,
              (SELECT coalesce(array_agg(DISTINCT m.tournament_id), '{}')
                 FROM match_officials mo JOIN matches m ON m.id = mo.match_id WHERE mo.user_id = $1) AS officiated
         FROM user_role_assignments ura
         JOIN role_permissions rp ON rp.role_id = ura.role_id
         JOIN users u ON u.id = ura.user_id AND u.is_active
        WHERE ura.user_id = $1`,
      [userId, global],
    );
    if (row?.all_visible) return null;
    return [...new Set([...(row?.scoped ?? []), ...(row?.officiated ?? [])])];
  }
}
