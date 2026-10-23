/**
 * Creates the platform administrator, or gives the existing one a new password. There is exactly one administrator;
 * the account is managed only here, on the server, never from the web interface.
 *
 *   npm run admin:reset               new password (and a generated login on first run)
 *   npm run admin:reset -- --new-login  also replaces the login
 *
 * To give a second installation (the local demo database) the same credentials, pass them once in the environment
 * of that command: FS_ADMIN_LOGIN and FS_ADMIN_PASSWORD. They are never written to a file.
 *
 * The credentials are printed once and stored nowhere but in the database (the password as a hash).
 * Every open administrator session is ended.
 */
import { randomInt } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../config/config.js';
import { pgOptions } from '../database/pg-options.js';
import { hashPassword } from '../common/password.js';

// No look-alike characters (0/O, 1/l/I): the password is read off a screen and typed by hand.
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '-_.+@';

const pick = (set: string) => set[randomInt(set.length)];

function generatePassword(length = 20) {
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS), ...Array.from({ length: length - 4 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const generateLogin = () => `root.${Array.from({ length: 8 }, () => pick(LOWER + DIGITS)).join('')}`;

const config = loadConfig();
const newLogin = process.argv.includes('--new-login');
const client = new pg.Client(pgOptions(config.DATABASE_URL, config));
await client.connect();
try {
  await client.query('BEGIN');
  const existing = await client.query<{ id: string; login: string }>(
    `SELECT u.id, u.login FROM users u
       JOIN user_role_assignments a ON a.user_id = u.id JOIN roles r ON r.id = a.role_id
      WHERE r.code = 'owner' FOR UPDATE OF u`,
  );
  const given = { login: process.env.FS_ADMIN_LOGIN?.trim(), password: process.env.FS_ADMIN_PASSWORD };
  if (given.password !== undefined && given.password.length < 12) throw new Error('FS_ADMIN_PASSWORD короче 12 символов');
  const password = given.password ?? generatePassword();
  const hash = await hashPassword(password);
  let login: string;
  let userId: string;
  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    login = given.login || (newLogin ? generateLogin() : existing.rows[0].login);
    await client.query(
      `UPDATE users SET login = $2, password_hash = $3, is_active = true, blocked_at = NULL, blocked_reason = NULL,
              deleted_at = NULL, updated_at = now() WHERE id = $1`,
      [userId, login, hash],
    );
    await client.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  } else {
    login = given.login || generateLogin();
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (login, display_name, password_hash) VALUES ($1, 'Администратор платформы', $2) RETURNING id`,
      [login, hash],
    );
    userId = user.rows[0].id;
    await client.query(`INSERT INTO user_role_assignments (user_id, role_id, scope_type) SELECT $1, id, 'system' FROM roles WHERE code = 'owner'`, [userId]);
  }
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data) VALUES (NULL, $1, 'user', $2, $3)`,
    [existing.rows[0] ? 'admin.credentials_reset' : 'admin.created', userId, { via: 'cli', newLogin: !existing.rows[0] || newLogin }],
  );
  await client.query('COMMIT');
  console.log(existing.rows[0] ? '\nАдминистратору платформы выдан новый пароль.' : '\nАдминистратор платформы создан.');
  console.log('Вход: /admin/login («Вход для администратора» на странице входа)\n');
  console.log(`  Логин:  ${login}`);
  console.log(`  Пароль: ${password}\n`);
  console.log('Сохраните их в менеджере паролей. Больше они нигде не показываются; потеряли — запустите команду снова.');
} catch (err) {
  await client.query('ROLLBACK');
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
