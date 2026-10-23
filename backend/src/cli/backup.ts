/**
 * Database backup and restore (docs/ARCHITECTURE.md §9): `pg_dump -Fc` into a dated file, `pg_restore` back.
 *
 *   npm run db:backup                      copy of DATABASE_URL into the backup folder, keeps the newest FS_BACKUP_KEEP
 *   npm run db:restore -- <file> --yes     replaces the contents of DATABASE_URL with the copy (asks for --yes)
 *
 * Folder: FS_BACKUP_DIR, default %LOCALAPPDATA%\FightScore\backups (outside the repository: a copy holds personal data).
 * PostgreSQL tools: PG_BIN, default C:\Program Files\PostgreSQL\18\bin on Windows, otherwise from PATH.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { loadConfig } from '../config/config.js';

const config = loadConfig();
const [command, file] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const yes = process.argv.includes('--yes');

const dir = process.env.FS_BACKUP_DIR ?? (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'FightScore', 'backups') : join(homedir(), '.fightscore', 'backups'));
const keep = Math.max(1, Number(process.env.FS_BACKUP_KEEP) || 30);
const pgBin = process.env.PG_BIN ?? (process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\18\\bin' : '');
const tool = (name: string) => {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const full = pgBin ? join(pgBin, exe) : exe;
  if (pgBin && !existsSync(full)) fail(`${full} не найден. Укажите папку PostgreSQL в PG_BIN.`);
  return full;
};

const url = new URL(config.DATABASE_URL);
const target = `${url.hostname}:${url.port || 5432}/${url.pathname.slice(1)}`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function run(exe: string, args: string[]) {
  // The password travels in PGPASSWORD, not on the command line where other processes could read it.
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
  const plain = new URL(config.DATABASE_URL);
  plain.password = '';
  const r = spawnSync(exe, [...args, `--dbname=${plain.toString()}`], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.error) fail(`Не удалось запустить ${basename(exe)}: ${r.error.message}`);
  if (r.status !== 0) fail(`${basename(exe)} завершился с ошибкой (код ${r.status}).`);
}

if (command === 'backup') {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const out = join(dir, `fightscore-${url.pathname.slice(1)}-${stamp}.dump`);
  run(tool('pg_dump'), ['--format=custom', '--no-owner', '--no-privileges', `--file=${out}`]);
  // Rotation: only this database's copies, newest first.
  const prefix = `fightscore-${url.pathname.slice(1)}-`;
  const copies = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.dump')).sort().reverse();
  for (const old of copies.slice(keep)) rmSync(join(dir, old));
  console.log(`Резервная копия ${target} сохранена:\n  ${out} (${Math.round(statSync(out).size / 1024)} КБ)`);
  console.log(`Хранятся последние ${keep} копий этой базы.`);
} else if (command === 'restore') {
  if (!file) fail('Укажите файл копии: npm run db:restore -- <файл> --yes');
  const path = resolve(file);
  if (!existsSync(path)) fail(`Файл не найден: ${path}`);
  if (!yes) fail(`Восстановление заменит все данные в ${target} содержимым ${basename(path)}.\nЕсли это то, что нужно, повторите команду с --yes.`);
  run(tool('pg_restore'), ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction', '--exit-on-error', path]);
  console.log(`База ${target} восстановлена из ${basename(path)}.`);
} else {
  fail('Использование: backup | restore <файл> --yes');
}
