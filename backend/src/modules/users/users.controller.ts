import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../../common/password.js';
import { login, parse, uuid } from '../../common/validation.js';
import { DatabaseService, type Db } from '../../database/database.service.js';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ClientIp, CurrentUser } from '../auth/auth.guard.js';
import type { SessionUser } from '../auth/auth.service.js';

/** Roles the administrator hands out. The administrator role itself is never assignable: there is exactly one. */
const ASSIGNABLE_ROLES = ['organizer', 'chief_judge', 'judge', 'display_operator'] as const;

const createSchema = z.object({
  login,
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  role: z.enum(ASSIGNABLE_ROLES),
});
const blockSchema = z.object({ reason: z.string().trim().max(300).optional() });
const passwordSchema = z.object({ password: z.string().min(MIN_PASSWORD_LENGTH).max(200) });
const deleteSchema = z.object({ confirmLogin: z.string().trim().min(1).max(100) });

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
      `SELECT u.id, u.login, u.display_name, u.is_active, u.last_login_at, u.created_at, u.blocked_at, u.blocked_reason,
              (u.password_hash IS NOT NULL) AS has_password,
              coalesce(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
              (SELECT count(*)::int FROM tournaments t WHERE t.created_by = u.id) AS tournaments,
              (SELECT count(*)::int FROM match_officials mo WHERE mo.user_id = u.id) AS matches_officiated
         FROM users u
         LEFT JOIN user_role_assignments ura ON ura.user_id = u.id AND ura.scope_type = 'system'
         LEFT JOIN roles r ON r.id = ura.role_id
        WHERE u.deleted_at IS NULL
        GROUP BY u.id ORDER BY u.created_at DESC`,
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

  /** Blocks sign-in and ends every open session at once. The account, its tournaments and its history stay. */
  @Post(':id/block')
  async block(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const { reason } = parse(blockSchema, body);
    return this.change(user, id, ip, 'user.block', { reason: reason || null }, async (c) => {
      await this.db.query(`UPDATE users SET is_active = false, blocked_at = now(), blocked_reason = $2, updated_at = now() WHERE id = $1`, [id, reason || null], c);
      return this.revokeSessions(id, c);
    });
  }

  @Post(':id/unblock')
  async unblock(@CurrentUser() user: SessionUser, @Param('id') id: string, @ClientIp() ip: string | null) {
    return this.change(user, id, ip, 'user.unblock', {}, async (c) => {
      await this.db.query(`UPDATE users SET is_active = true, blocked_at = NULL, blocked_reason = NULL, updated_at = now() WHERE id = $1`, [id], c);
      return 0;
    });
  }

  /** Sets a new password (for a user who forgot theirs) and signs them out everywhere. */
  @Post(':id/password')
  async setPassword(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: unknown, @ClientIp() ip: string | null) {
    const { password } = parse(passwordSchema, body);
    const hash = await hashPassword(password);
    return this.change(user, id, ip, 'user.password_reset', {}, async (c) => {
      await this.db.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [id, hash], c);
      return this.revokeSessions(id, c);
    });
  }

  /**
   * Deletes an account: it can never sign in again and disappears from lists, while every match event and audit row
   * that references it stays (history is never erased). Personal data is removed: login and name are replaced.
   * The administrator retypes the login to confirm, like the "type the repository name" step on code hosts.
   */
  @Delete(':id')
  async remove(@CurrentUser() user: SessionUser, @Param('id') id: string, @Query() query: unknown, @ClientIp() ip: string | null) {
    const { confirmLogin } = parse(deleteSchema, query);
    return this.change(user, id, ip, 'user.delete', {}, async (c, target) => {
      if (confirmLogin.toLowerCase() !== target.login.toLowerCase()) {
        throw new AppError('VALIDATION', 'Логин для подтверждения не совпадает', [{ path: 'confirmLogin', message: 'Введите логин удаляемого аккаунта' }]);
      }
      await this.db.query(
        `UPDATE users SET deleted_at = now(), is_active = false, password_hash = NULL,
                login = 'deleted-' || id, display_name = 'Удалённый пользователь', updated_at = now()
          WHERE id = $1`,
        [id],
        c,
      );
      await this.db.query(`DELETE FROM user_role_assignments WHERE user_id = $1`, [id], c);
      return this.revokeSessions(id, c);
    });
  }

  /** Shared guard and audit for administrator actions on another account. */
  private async change(
    user: SessionUser,
    id: string,
    ip: string | null,
    action: string,
    data: Record<string, unknown>,
    apply: (c: Db, target: { login: string }) => Promise<number>,
  ) {
    await this.access.require(user.id, 'user.manage');
    const targetId = parse(uuid, id);
    if (targetId === user.id) throw new AppError('CONFLICT', 'Это действие нельзя выполнить со своим аккаунтом');
    return this.db.tx(async (c) => {
      const target = await this.db.one<{ login: string; is_admin: boolean }>(
        `SELECT u.login, EXISTS (SELECT 1 FROM user_role_assignments a JOIN roles r ON r.id = a.role_id
                                  WHERE a.user_id = u.id AND r.code = 'owner') AS is_admin
           FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL FOR UPDATE`,
        [targetId],
        c,
      );
      if (!target) throw new AppError('NOT_FOUND', 'Пользователь не найден');
      if (target.is_admin) throw new AppError('FORBIDDEN', 'Аккаунт администратора платформы меняется только командой на сервере');
      const sessions = await apply(c, target);
      await this.audit.record(
        { actorUserId: user.id, action, entityType: 'user', entityId: targetId, data: { login: target.login, ...data, endedSessions: sessions }, ip },
        c,
      );
      return { ok: true };
    });
  }

  private async revokeSessions(userId: string, c: Db) {
    const rows = await this.db.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`, [userId], c);
    return rows.length;
  }
}

/** Platform overview for the administrator: counts and the latest audit entries. Read-only. */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
  ) {}

  @Get('overview')
  async overview(@CurrentUser() user: SessionUser) {
    await this.access.require(user.id, 'user.manage');
    return this.db.one(
      `SELECT
         (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS users,
         (SELECT count(*)::int FROM users WHERE deleted_at IS NULL AND blocked_at IS NOT NULL) AS blocked,
         (SELECT count(DISTINCT s.user_id)::int FROM sessions s WHERE s.revoked_at IS NULL AND s.expires_at > now()
             AND s.last_seen_at > now() - interval '15 minutes') AS online,
         (SELECT count(*)::int FROM tournaments) AS tournaments,
         (SELECT count(*)::int FROM matches WHERE status = 'live') AS live_matches,
         (SELECT count(*)::int FROM matches) AS matches,
         (SELECT count(*)::int FROM audit_log WHERE action IN ('auth.login_failed', 'auth.admin_login_failed')
             AND occurred_at > now() - interval '24 hours') AS failed_logins_24h`,
    );
  }

  @Get('audit')
  async auditLog(@CurrentUser() user: SessionUser, @Query('limit') limit?: string) {
    await this.access.require(user.id, 'user.manage');
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.db.query(
      `SELECT a.id, a.occurred_at, a.action, a.entity_type, a.data, host(a.ip) AS ip, u.display_name AS actor
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
        ORDER BY a.occurred_at DESC LIMIT $1`,
      [n],
    );
  }
}
