import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../../common/password.js';
import { login, parse } from '../../common/validation.js';
import { DatabaseService } from '../../database/database.service.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ClientIp, CurrentUser } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';

const ASSIGNABLE_ROLES = ['organizer', 'chief_judge', 'judge', 'display_operator'] as const;

const createSchema = z.object({
  login,
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  role: z.enum(ASSIGNABLE_ROLES),
});

@Controller('users')
export class UsersController {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: SessionUser) {
    await this.access.require(user.id, 'user.manage');
    return this.db.query(
      `SELECT u.id, u.login, u.display_name, u.is_active, u.last_login_at, (u.password_hash IS NOT NULL) AS has_password,
              coalesce(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN user_role_assignments ura ON ura.user_id = u.id AND ura.scope_type = 'system'
         LEFT JOIN roles r ON r.id = ura.role_id
        GROUP BY u.id ORDER BY u.display_name`,
    );
  }

  /** Users that may be assigned as match officials (system role chief_judge, judge or owner). */
  @Get('officials')
  async officials(@CurrentUser() user: SessionUser) {
    await this.access.require(user.id, 'tournament.manage');
    return this.db.query(
      `SELECT DISTINCT u.id, u.login, u.display_name
         FROM users u
         JOIN user_role_assignments ura ON ura.user_id = u.id
         JOIN role_permissions rp ON rp.role_id = ura.role_id AND rp.permission = 'match.officiate'
        WHERE u.is_active AND u.password_hash IS NOT NULL
        ORDER BY u.display_name`,
    );
  }

  @Post()
  async create(@CurrentUser() user: SessionUser, @Body() body: unknown, @ClientIp() ip: string | null) {
    await this.access.require(user.id, 'user.manage');
    const input = parse(createSchema, body);
    const hash = await hashPassword(input.password);
    return this.db.tx(async (c) => {
      const created = await this.db.one(
        `INSERT INTO users (login, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, login, display_name`,
        [input.login, input.displayName, hash],
        c,
      );
      await this.db.query(
        `INSERT INTO user_role_assignments (user_id, role_id, scope_type, granted_by)
         SELECT $1, id, 'system', $2 FROM roles WHERE code = $3`,
        [created.id, user.id, input.role],
        c,
      );
      await this.audit.record(
        { actorUserId: user.id, action: 'user.create', entityType: 'user', entityId: created.id, data: { login: input.login, role: input.role }, ip },
        c,
      );
      return created;
    });
  }
}
