import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { AppError } from '../../common/errors.js';
import { hashPassword, verifyPassword } from '../../common/password.js';
import { DatabaseService, type Db } from '../../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';

export interface SessionUser {
  id: string;
  login: string;
  displayName: string;
}

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 5 * 60_000;
const TICKET_TTL_MS = 30_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;
/** The platform administrator signs in for a working day, not a week: a forgotten admin session is the costliest one. */
export const ADMIN_SESSION_TTL_SEC = 8 * 3600;

/**
 * Two doors: the regular sign-in for organizers and judges, and a separate one for the platform administrator.
 * Each door accepts only its own accounts and answers every mismatch with the same generic error, so the regular
 * form cannot be used to find out which login belongs to the administrator.
 */
export type LoginDoor = 'user' | 'admin';

const sha256 = (s: string) => createHash('sha256').update(s).digest();

@Injectable()
export class AuthService {
  private readonly failures = new Map<string, number[]>();
  private readonly tickets = new Map<string, { userId: string; expires: number }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get sessionTtlSec() {
    return this.config.SESSION_TTL_HOURS * 3600;
  }

  private checkRate(key: string) {
    const now = Date.now();
    const recent = (this.failures.get(key) ?? []).filter((t) => now - t < FAILURE_WINDOW_MS);
    this.failures.set(key, recent);
    if (recent.length >= MAX_FAILURES) {
      throw new AppError('RATE_LIMITED', 'Слишком много попыток. Подождите несколько минут.');
    }
  }

  async login(login: string, password: string, ip: string | null, userAgent: string | null, door: LoginDoor = 'user') {
    // The admin door is limited per address, whatever login is tried: guessing the secret login is throttled too.
    const key = door === 'admin' ? `admin|${ip ?? '?'}` : `${ip ?? '?'}|${login.toLowerCase()}`;
    this.checkRate(key);
    const user = await this.db.one(
      `SELECT u.id, u.login, u.display_name, u.password_hash, u.is_active, u.blocked_at IS NOT NULL AS blocked,
              EXISTS (SELECT 1 FROM user_role_assignments a JOIN roles r ON r.id = a.role_id
                       WHERE a.user_id = u.id AND r.code = 'owner') AS is_admin
         FROM users u WHERE lower(u.login) = lower($1) AND u.deleted_at IS NULL`,
      [login],
    );
    const rightDoor = !!user && user.is_admin === (door === 'admin');
    const passwordOk = rightDoor && (await verifyPassword(password, user.password_hash));
    if (!passwordOk || !user.is_active) {
      this.failures.get(key)!.push(Date.now());
      await this.audit.record({
        actorUserId: user?.id ?? null,
        action: door === 'admin' ? 'auth.admin_login_failed' : 'auth.login_failed',
        entityType: 'user',
        entityId: user?.id ?? null,
        data: { login, ...(passwordOk ? { blocked: true } : {}) },
        ip,
      });
      // Only someone who knows the password learns that the account is blocked.
      if (passwordOk && user.blocked) throw new AppError('FORBIDDEN', 'Аккаунт заблокирован администратором платформы. Обратитесь к организатору турнира.');
      throw new AppError('UNAUTHENTICATED', 'Неверный логин или пароль');
    }
    this.failures.delete(key);
    const ttl = door === 'admin' ? ADMIN_SESSION_TTL_SEC : this.sessionTtlSec;
    // Session, last_login_at and the audit row in one atomic statement (one round trip, no explicit transaction).
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      `WITH s AS (
         INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
         VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5) RETURNING id
       ), u AS (
         UPDATE users SET last_login_at = now() WHERE id = $1 RETURNING id
       )
       INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, ip, data)
       SELECT $1, $6, 'user', $1, $4, '{}' FROM s, u`,
      [user.id, sha256(token), ttl, ip, userAgent?.slice(0, 300) ?? null, door === 'admin' ? 'auth.admin_login' : 'auth.login'],
    );
    return { token, ttl, user: { id: user.id, login: user.login, displayName: user.display_name } as SessionUser };
  }

  /**
   * Self-service organizer sign-up. Grants only `organizer_self` (create tournaments and athletes);
   * judge or admin rights can never be obtained this way.
   */
  async register(input: { login: string; displayName: string; password: string }, ip: string | null, userAgent: string | null) {
    if (!this.config.allowRegistration) throw new AppError('FORBIDDEN', 'Регистрация отключена. Учётную запись выдаёт администратор системы.');
    const key = `register|${ip ?? '?'}`;
    this.checkRate(key);
    this.failures.set(key, [...(this.failures.get(key) ?? []), Date.now()]);
    const hash = await hashPassword(input.password);
    return this.db.tx(async (c) => {
      const user = await this.db.one(
        `INSERT INTO users (login, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, login, display_name`,
        [input.login, input.displayName, hash],
        c,
      );
      await this.db.query(
        `INSERT INTO user_role_assignments (user_id, role_id, scope_type) SELECT $1, id, 'system' FROM roles WHERE code = 'organizer_self'`,
        [user.id],
        c,
      );
      await this.audit.record({ actorUserId: user.id, action: 'auth.register', entityType: 'user', entityId: user.id, data: { login: input.login }, ip }, c);
      const token = await this.createSession(c, user.id, ip, userAgent);
      return { token, user: { id: user.id, login: user.login, displayName: user.display_name } as SessionUser };
    });
  }

  private async createSession(c: Db, userId: string, ip: string | null, userAgent: string | null): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5)`,
      [userId, sha256(token), this.sessionTtlSec, ip, userAgent?.slice(0, 300) ?? null],
      c,
    );
    await this.db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId], c);
    return token;
  }

  async resolve(token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null;
    const row = await this.db.one(
      `SELECT s.id, s.last_seen_at, u.id AS user_id, u.login, u.display_name
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active`,
      [sha256(token)],
    );
    if (!row) return null;
    if (Date.now() - new Date(row.last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
      await this.db.query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [row.id]);
    }
    return { id: row.user_id, login: row.login, displayName: row.display_name };
  }

  /**
   * Sliding expiry: moves the session's end to "now + lifetime" and returns that lifetime for the cookie, so someone
   * who keeps using the app is never asked to sign in again. Called on GET /auth/me, i.e. once per app start.
   * The administrator keeps the short admin lifetime, renewed the same way.
   */
  async renew(token: string | undefined): Promise<number | null> {
    if (!token) return null;
    const row = await this.db.one<{ is_admin: boolean }>(
      `UPDATE sessions s SET last_seen_at = now(),
              expires_at = now() + make_interval(secs => CASE WHEN a.is_admin THEN $2::float8 ELSE $3::float8 END)
         FROM (SELECT EXISTS (SELECT 1 FROM sessions s2 JOIN user_role_assignments ura ON ura.user_id = s2.user_id
                                JOIN roles r ON r.id = ura.role_id
                               WHERE s2.token_hash = $1 AND r.code = 'owner') AS is_admin) a
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
        RETURNING a.is_admin`,
      [sha256(token), ADMIN_SESSION_TTL_SEC, this.sessionTtlSec],
    );
    if (!row) return null;
    return row.is_admin ? ADMIN_SESSION_TTL_SEC : this.sessionTtlSec;
  }

  async logout(token: string | undefined, user: SessionUser | null, ip: string | null) {
    if (!token) return;
    await this.db.query(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sha256(token)]);
    if (user) await this.audit.record({ actorUserId: user.id, action: 'auth.logout', entityType: 'user', entityId: user.id, ip });
  }

  async updateProfile(user: SessionUser, displayName: string, ip: string | null): Promise<SessionUser> {
    await this.db.tx(async (c) => {
      await this.db.query(`UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1`, [user.id, displayName], c);
      await this.audit.record({ actorUserId: user.id, action: 'auth.profile_update', entityType: 'user', entityId: user.id, data: { displayName }, ip }, c);
    });
    return { ...user, displayName };
  }

  /**
   * Changes the own password after checking the current one. Other sessions are revoked so a stolen
   * session cannot outlive the change; the current session stays signed in.
   */
  async changePassword(user: SessionUser, currentToken: string | undefined, current: string, next: string, ip: string | null) {
    const key = `password|${user.id}`;
    this.checkRate(key);
    const row = await this.db.one(`SELECT password_hash FROM users WHERE id = $1`, [user.id]);
    if (!row || !(await verifyPassword(current, row.password_hash))) {
      this.failures.set(key, [...(this.failures.get(key) ?? []), Date.now()]);
      throw new AppError('VALIDATION', 'Текущий пароль указан неверно', [{ path: 'currentPassword', message: 'Неверный пароль' }]);
    }
    if (current === next) throw new AppError('VALIDATION', 'Новый пароль совпадает с текущим', [{ path: 'newPassword', message: 'Придумайте другой пароль' }]);
    const hash = await hashPassword(next);
    const revoked = await this.db.tx(async (c) => {
      await this.db.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [user.id, hash], c);
      const r = await this.db.query(
        `UPDATE sessions SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL AND ($2::bytea IS NULL OR token_hash <> $2) RETURNING id`,
        [user.id, currentToken ? sha256(currentToken) : null],
        c,
      );
      await this.audit.record({ actorUserId: user.id, action: 'auth.password_change', entityType: 'user', entityId: user.id, data: { revokedSessions: r.length }, ip }, c);
      return r.length;
    });
    this.failures.delete(key);
    return { revokedSessions: revoked };
  }

  /** Single-use, short-lived ticket for the Socket.IO handshake (docs/ARCHITECTURE.md §9.2, question Ж). */
  issueTicket(userId: string): string {
    const now = Date.now();
    for (const [k, v] of this.tickets) if (v.expires < now) this.tickets.delete(k);
    const ticket = randomBytes(24).toString('base64url');
    this.tickets.set(ticket, { userId, expires: now + TICKET_TTL_MS });
    return ticket;
  }

  async consumeTicket(ticket: unknown): Promise<SessionUser | null> {
    if (typeof ticket !== 'string') return null;
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!entry || entry.expires < Date.now()) return null;
    const row = await this.db.one(`SELECT id, login, display_name FROM users WHERE id = $1 AND is_active`, [entry.userId]);
    return row ? { id: row.id, login: row.login, displayName: row.display_name } : null;
  }
}
