import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { isoDate, parse, trimmed, uuid } from '../../common/validation.js';
import { DatabaseService } from '../../database/database.service.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ClientIp, CurrentUser } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';

const athleteSchema = z
  .object({
    firstName: trimmed(80),
    lastName: trimmed(80),
    birthDate: isoDate.nullish(),
    birthYear: z.coerce.number().int().min(1900).max(2100).nullish(),
    countryId: uuid,
    clubName: z.string().trim().max(120).nullish(),
    updatedAt: z.string().optional(),
  })
  .refine((a) => !a.birthDate || !a.birthYear || Number(a.birthDate.slice(0, 4)) === a.birthYear, {
    message: 'Год рождения не совпадает с датой',
    path: ['birthYear'],
  });

const ATHLETE_SELECT = `
  SELECT a.id, a.first_name, a.last_name, a.birth_date, a.birth_year, a.updated_at, a.created_by,
         c.id AS country_id, c.iso_alpha2 AS country_code, c.name AS country_name,
         cl.id AS club_id, cl.name AS club_name
    FROM athletes a
    JOIN countries c ON c.id = a.country_id
    LEFT JOIN clubs cl ON cl.id = a.club_id`;

@Controller()
export class AthletesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get('countries')
  countries() {
    return this.db.query(`SELECT id, iso_alpha2 AS code, name FROM countries WHERE archived_at IS NULL ORDER BY name`);
  }

  @Get('clubs')
  clubs() {
    return this.db.query(`SELECT id, name, country_id FROM clubs WHERE archived_at IS NULL ORDER BY name`);
  }

  /**
   * Without system-wide athlete.manage a user sees only athletes they added or that are registered
   * in tournaments visible to them: self-registered organizers never see other organizers' data.
   */
  @Get('athletes')
  async list(@CurrentUser() user: SessionUser, @Query('q') q?: string) {
    const all = await this.access.can(user.id, 'athlete.manage');
    const visible = all ? null : await this.access.visibleTournamentIds(user.id);
    const rows = await this.db.query(
      `${ATHLETE_SELECT}
        WHERE a.archived_at IS NULL
          AND ($2::boolean OR $4::uuid[] IS NULL OR a.created_by = $3
               OR EXISTS (SELECT 1 FROM tournament_athletes ta WHERE ta.athlete_id = a.id AND ta.tournament_id = ANY($4)))
          AND ($1::text IS NULL OR a.last_name ILIKE '%' || $1 || '%' OR a.first_name ILIKE '%' || $1 || '%')
        ORDER BY lower(a.last_name), lower(a.first_name) LIMIT 500`,
      [q?.trim() || null, all, user.id, visible],
    );
    return rows.map((r) => ({ ...r, can_edit: all || r.created_by === user.id }));
  }

  @Post('athletes')
  async create(@CurrentUser() user: SessionUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    const grants = await this.access.grants(user.id);
    if (!grants.some((g) => g.permission === 'athlete.manage' || g.permission === 'athlete.create')) {
      throw new AppError('FORBIDDEN', 'Недостаточно прав для добавления спортсменов', { permission: 'athlete.create' });
    }
    const a = parse(athleteSchema, body);
    return this.db.tx(async (c) => {
      const clubId = await this.clubId(a.clubName, a.countryId, c);
      const row = await this.db.one(
        `INSERT INTO athletes (first_name, last_name, birth_date, birth_year, country_id, club_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [a.firstName, a.lastName, a.birthDate ?? null, a.birthYear ?? null, a.countryId, clubId, user.id],
        c,
      );
      await this.audit.record({ actorUserId: user.id, action: 'athlete.create', entityType: 'athlete', entityId: row.id, data: a, ip }, c);
      const created = await this.db.one(`${ATHLETE_SELECT} WHERE a.id = $1`, [row.id], c);
      return { ...created, can_edit: true };
    });
  }

  /** Optimistic locking: the client sends the `updatedAt` it read (docs/DATABASE.md §4). */
  @Put('athletes/:id')
  async update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const all = await this.access.can(user.id, 'athlete.manage');
    const a = parse(athleteSchema, body);
    return this.db.tx(async (c) => {
      const clubId = await this.clubId(a.clubName, a.countryId, c);
      const row = await this.db.one(
        `UPDATE athletes SET first_name = $2, last_name = $3, birth_date = $4, birth_year = $5, country_id = $6, club_id = $7,
                updated_at = now()
          WHERE id = $1 AND ($8::timestamptz IS NULL OR date_trunc('milliseconds', updated_at) = $8)
            AND ($9::boolean OR created_by = $10)
        RETURNING id`,
        [parse(uuid, id), a.firstName, a.lastName, a.birthDate ?? null, a.birthYear ?? null, a.countryId, clubId, a.updatedAt ?? null, all, user.id],
        c,
      );
      if (!row) throw new AppError('CONFLICT', 'Спортсмен не найден, изменён другим пользователем или добавлен не вами. Обновите страницу.');
      await this.audit.record({ actorUserId: user.id, action: 'athlete.update', entityType: 'athlete', entityId: id, data: a, ip }, c);
      const updated = await this.db.one(`${ATHLETE_SELECT} WHERE a.id = $1`, [id], c);
      return { ...updated, can_edit: true };
    });
  }

  private async clubId(name: string | null | undefined, countryId: string, c: Parameters<DatabaseService['query']>[2]) {
    if (!name) return null;
    const existing = await this.db.one(`SELECT id FROM clubs WHERE lower(name) = lower($1) AND country_id = $2`, [name, countryId], c);
    if (existing) return existing.id;
    const created = await this.db.one(`INSERT INTO clubs (name, country_id) VALUES ($1, $2) RETURNING id`, [name, countryId], c);
    return created.id;
  }
}
