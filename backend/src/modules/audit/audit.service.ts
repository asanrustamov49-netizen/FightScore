import { Injectable } from '@nestjs/common';
import { DatabaseService, type Db } from '../../database/database.service.js';

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  tournamentId?: string | null;
  data?: Record<string, unknown>;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  /** Pass the transaction client so the audit row commits or rolls back with the change. */
  async record(entry: AuditEntry, db?: Db) {
    await this.db.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, tournament_id, data, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.actorUserId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.tournamentId ?? null,
        entry.data ?? {},
        entry.ip ?? null,
      ],
      db,
    );
  }

  list(filter: { tournamentId?: string; limit: number }) {
    return this.db.query(
      `SELECT a.id, a.occurred_at, a.action, a.entity_type, a.entity_id, a.tournament_id, a.data,
              u.display_name AS actor_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ($1::uuid IS NULL OR a.tournament_id = $1)
        ORDER BY a.occurred_at DESC LIMIT $2`,
      [filter.tournamentId ?? null, filter.limit],
    );
  }
}
