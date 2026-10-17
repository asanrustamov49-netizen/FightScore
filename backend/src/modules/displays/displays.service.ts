import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Subject } from 'rxjs';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { parse, trimmed, uuid } from '../../common/validation.js';
import { DatabaseService } from '../../database/database.service.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { SessionUser } from '../auth/auth.service.js';
import { MatchesService } from '../matches/matches.service.js';

const createSchema = z.object({ tournamentId: uuid, name: trimmed(80) });
const assignSchema = z.object({ matchId: uuid.nullable() });

export interface DisplayChanged {
  displayId: string;
  matchId: string | null;
}

@Injectable()
export class DisplaysService {
  /** Emits when a display is pointed at another match or its token is revoked. */
  readonly changes = new Subject<DisplayChanged & { revokedToken?: string }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly matches: MatchesService,
  ) {}

  async list(user: SessionUser) {
    const visible = await this.access.visibleTournamentIds(user.id);
    return this.db.query(
      `SELECT d.id, d.name, d.public_token, d.current_match_id, d.tournament_id, t.name AS tournament_name, m.match_number
         FROM displays d JOIN tournaments t ON t.id = d.tournament_id
         LEFT JOIN matches m ON m.id = d.current_match_id
        WHERE d.is_active AND ($1::uuid[] IS NULL OR d.tournament_id = ANY($1))
        ORDER BY t.name, d.name`,
      [visible],
    );
  }

  async create(user: SessionUser, body: unknown, ip: string | null) {
    const d = parse(createSchema, body);
    await this.access.require(user.id, 'display.operate', d.tournamentId);
    return this.db.tx(async (c) => {
      const row = await this.db.one(
        `INSERT INTO displays (tournament_id, name, public_token, created_by) VALUES ($1, $2, $3, $4) RETURNING id, public_token`,
        [d.tournamentId, d.name, randomBytes(24).toString('base64url'), user.id],
        c,
      );
      await this.audit.record(
        { actorUserId: user.id, action: 'display.create', entityType: 'display', entityId: row.id, tournamentId: d.tournamentId, data: { name: d.name }, ip },
        c,
      );
      return row;
    });
  }

  async assign(user: SessionUser, displayId: string, body: unknown, ip: string | null) {
    const { matchId } = parse(assignSchema, body);
    const d = await this.load(user, displayId);
    await this.db.tx(async (c) => {
      if (matchId) {
        const m = await this.db.one(`SELECT tournament_id FROM matches WHERE id = $1`, [matchId], c);
        if (!m || m.tournament_id !== d.tournament_id) throw new AppError('VALIDATION', 'Поединок из другого турнира');
      }
      await this.db.query(`UPDATE displays SET current_match_id = $2, updated_at = now() WHERE id = $1`, [displayId, matchId], c);
      await this.audit.record(
        { actorUserId: user.id, action: 'display.assign', entityType: 'display', entityId: displayId, tournamentId: d.tournament_id, data: { matchId }, ip },
        c,
      );
    });
    this.changes.next({ displayId, matchId });
    return { ok: true };
  }

  async rotateToken(user: SessionUser, displayId: string, ip: string | null) {
    const d = await this.load(user, displayId);
    const token = randomBytes(24).toString('base64url');
    await this.db.tx(async (c) => {
      await this.db.query(`UPDATE displays SET public_token = $2, updated_at = now() WHERE id = $1`, [displayId, token], c);
      await this.audit.record(
        { actorUserId: user.id, action: 'display.rotate_token', entityType: 'display', entityId: displayId, tournamentId: d.tournament_id, ip },
        c,
      );
    });
    this.changes.next({ displayId, matchId: d.current_match_id, revokedToken: d.public_token });
    return { public_token: token };
  }

  /** Public, read-only: resolves a display token to the public view of its current match. */
  async publicView(token: string) {
    const d = await this.db.one(
      `SELECT d.id, d.name, d.current_match_id, t.name AS tournament_name
         FROM displays d JOIN tournaments t ON t.id = d.tournament_id WHERE d.public_token = $1 AND d.is_active`,
      [token],
    );
    if (!d) throw new AppError('NOT_FOUND', 'Табло не найдено');
    const match = d.current_match_id ? this.matches.publicView(await this.matches.snapshot(d.current_match_id)) : null;
    return { display: { id: d.id, name: d.name, tournamentName: d.tournament_name }, match };
  }

  private async load(user: SessionUser, displayId: string) {
    const d = await this.db.one(`SELECT tournament_id, current_match_id, public_token FROM displays WHERE id = $1`, [parse(uuid, displayId)]);
    if (!d) throw new AppError('NOT_FOUND', 'Табло не найдено');
    await this.access.require(user.id, 'display.operate', d.tournament_id);
    return d;
  }
}
