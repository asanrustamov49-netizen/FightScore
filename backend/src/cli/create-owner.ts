/** Creates the first system owner. The password is read from the terminal without echo. */
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import pg from 'pg';
import { loadConfig } from '../config/config.js';
import { pgOptions } from '../database/pg-options.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../common/password.js';

async function askHidden(question: string): Promise<string> {
  stdout.write(question);
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off('data', onData);
        stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const config = loadConfig();
const rl = createInterface({ input: stdin, output: stdout });
const login = (await rl.question('Логин владельца: ')).trim();
const displayName = (await rl.question('Отображаемое имя: ')).trim() || login;
rl.close();
const password = await askHidden(`Пароль (не короче ${MIN_PASSWORD_LENGTH} символов): `);
const repeat = await askHidden('Повторите пароль: ');
if (!login || password.length < MIN_PASSWORD_LENGTH || password !== repeat) {
  console.error('Логин пуст, пароль слишком короткий или пароли не совпадают.');
  process.exit(1);
}

const client = new pg.Client(pgOptions(config.DATABASE_URL, config));
await client.connect();
try {
  await client.query('BEGIN');
  const user = await client.query(
    `INSERT INTO users (login, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [login, displayName, await hashPassword(password)],
  );
  const userId = user.rows[0].id;
  await client.query(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
     SELECT $1, id, 'system' FROM roles WHERE code = 'owner'`,
    [userId],
  );
  await client.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
     VALUES (NULL, 'user.create_owner', 'user', $1, $2)`,
    [userId, { login, via: 'cli' }],
  );
  await client.query('COMMIT');
  console.log(`Владелец "${login}" создан.`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
