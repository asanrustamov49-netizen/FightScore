#!/usr/bin/env bash
# FightScore local demo for Git Bash on Windows: a persistent PostgreSQL cluster, backend and frontend,
# all bound to 127.0.0.1. Never touches Supabase, backend/.env or the system PostgreSQL service.
#
#   scripts/demo.sh init      one-time setup (safe to re-run; resumes an interrupted setup)
#   scripts/demo.sh start     start database, backend, frontend
#   scripts/demo.sh stop      stop what this demo started (other processes are never killed)
#   scripts/demo.sh status    report each component; exit code 1 if anything is not running
#   scripts/demo.sh rebuild   rebuild backend and frontend (demo must be stopped)
#
# Web port: FS_DEMO_WEB_PORT (default 3000; remembered for later stop/status), e.g. when 3000 is taken.
# Overrides (for tests): FS_DEMO_DIR, FS_DEMO_PGPORT, FS_DEMO_ENV, PG_BIN.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_W="$(cygpath -m "$ROOT")"
PG_BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
HOME_DIR="${FS_DEMO_DIR:-$(cygpath -u "$LOCALAPPDATA")/FightScore}"
PGDATA="$HOME_DIR/pgdemo"
PGPORT="${FS_DEMO_PGPORT:-54330}"
RUN="$HOME_DIR/run"
MARKER="$HOME_DIR/.initialized"
ENV_DEMO="${FS_DEMO_ENV:-$ROOT/backend/.env.demo}" # gitignored; holds the generated DB password
BACKEND_PORT=3001
DEFAULT_WEB_PORT=3000
# Explicit FS_DEMO_WEB_PORT wins; otherwise the port of the last start, so stop/status find the same process.
FRONTEND_PORT="${FS_DEMO_WEB_PORT:-$(tr -dc '0-9' 2>/dev/null <"$RUN/frontend.port" || true)}"
FRONTEND_PORT="${FRONTEND_PORT:-$DEFAULT_WEB_PORT}"
DEMO_DB=fightscore_demo
TEST_DB=fightscore_test
DB_USER=fightscore
# Our processes are recognised by absolute entry paths of this checkout plus a demo flag.
BACKEND_ENTRY="$ROOT_W/backend/dist/main.js"
FRONTEND_ENTRY="$ROOT_W/frontend/node_modules/next/dist/bin/next"
DEMO_FLAG="--fightscore-demo"

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[[ "$FRONTEND_PORT" =~ ^[0-9]{4,5}$ ]] && [ "$FRONTEND_PORT" -ge 1024 ] && [ "$FRONTEND_PORT" -le 65535 ] && [ "$FRONTEND_PORT" != "$BACKEND_PORT" ] ||
  die "FS_DEMO_WEB_PORT must be a port from 1024 to 65535 other than $BACKEND_PORT"
lower() { printf '%s' "$1" | tr 'A-Z\\' 'a-z/'; }
pg() { "$PG_BIN/$1.exe" "${@:2}"; }

# Runs a Windows program outside this console, so a later Ctrl+C in this terminal cannot stop it.
# $1 = wait (exit with its code) | nowait, $2 = log file (Windows path) or "", $3 = program, rest = arguments.
detached() {
  node -e 'const fs = require("fs"), { spawn } = require("child_process");
const [mode, log, cmd, ...args] = process.argv.slice(1);
const out = log ? fs.openSync(log, "w") : "ignore";
const child = spawn(cmd, args, { detached: true, stdio: ["ignore", out, out], windowsHide: true });
child.on("error", (e) => { console.error(e.message); process.exit(1); });
if (mode === "wait") child.on("exit", (code) => process.exit(code ?? 1)); else child.unref();' "$@"
}

# ---------- configuration (never printed: it contains the password) ----------

DB_PASS="" DB_URL="" TEST_URL="" DEMO_PW=""
read_env() {
  [ -f "$ENV_DEMO" ] || die "$ENV_DEMO not found. Run: scripts/demo.sh init"
  DB_URL="$(sed -n 's/^DATABASE_URL=//p' "$ENV_DEMO" | head -n1 | tr -d '\r')"
  TEST_URL="$(sed -n 's/^TEST_DATABASE_URL=//p' "$ENV_DEMO" | head -n1 | tr -d '\r')"
  # Optional: setups made before it existed take DEMO_PASSWORD from backend/.env (their users were seeded with it).
  DEMO_PW="$(sed -n 's/^DEMO_PASSWORD=//p' "$ENV_DEMO" | head -n1 | tr -d '\r')"
  local re="^postgres://$DB_USER:([A-Za-z0-9_-]+)@127\.0\.0\.1:$PGPORT/"
  [[ "$DB_URL" =~ ${re}${DEMO_DB}$ ]] || die "DATABASE_URL in $ENV_DEMO does not point to 127.0.0.1:$PGPORT/$DEMO_DB; refusing to continue"
  DB_PASS="${BASH_REMATCH[1]}"
  [[ "$TEST_URL" =~ ${re}${TEST_DB}$ ]] || die "TEST_DATABASE_URL in $ENV_DEMO does not point to 127.0.0.1:$PGPORT/$TEST_DB"
}

write_env() { # $1 = database password, $2 = demo-user password; atomic, owner-only
  local tmp="$ENV_DEMO.tmp.$$"
  (umask 077; cat >"$tmp" <<EOF
# Local demo database (scripts/demo.sh). Generated, never commit.
DATABASE_URL=postgres://$DB_USER:$1@127.0.0.1:$PGPORT/$DEMO_DB
TEST_DATABASE_URL=postgres://$DB_USER:$1@127.0.0.1:$PGPORT/$TEST_DB
# Password of demo.organizer, demo.chief, demo.judge. Changing it later does not change existing users.
DEMO_PASSWORD=$2
EOF
  )
  mv -f "$tmp" "$ENV_DEMO"
}

# ---------- processes and ports ----------

# PID of whatever listens on TCP port $1 (any local address), empty if free.
listener_pid() {
  # IPv4 and IPv6 ([::]:port) listeners alike.
  netstat -ano | tr -d '\r' | awk -v p=":$1" '
    $1 ~ /^TCP/ && $4 == "LISTENING" && substr($2, length($2) - length(p) + 1) == p { print $5; exit }'
}

cmdline() { # Windows command line of PID $1, empty if gone
  powershell -NoProfile -Command "\$p = Get-CimInstance Win32_Process -Filter 'ProcessId=$1'; if (\$p) { \$p.CommandLine }" 2>/dev/null | tr -d '\r'
}

is_ours() { # $1 = backend|frontend, $2 = PID
  local cl; cl="$(lower "$(cmdline "$2")")"
  case "$1" in
    backend) [[ "$cl" == *"$(lower "$BACKEND_ENTRY")"* && "$cl" == *"$DEMO_FLAG"* ]] ;;
    frontend) [[ "$cl" == *"$(lower "$FRONTEND_ENTRY")"* && "$cl" == *" start "* ]] ;;
  esac
}

port_of() { [ "$1" = backend ] && echo "$BACKEND_PORT" || echo "$FRONTEND_PORT"; }

# Prints: ours <pid> | foreign <pid> | free
owner() {
  local pid; pid="$(listener_pid "$(port_of "$1")")"
  if [ -z "$pid" ]; then echo free
  elif is_ours "$1" "$pid"; then echo "ours $pid"
  else echo "foreign $pid"; fi
}

wait_free() { for _ in $(seq 1 20); do [ -z "$(listener_pid "$1")" ] && return 0; sleep 0.5; done; return 1; }

healthy() {
  case "$1" in
    backend) curl -sf --max-time 5 "http://127.0.0.1:$BACKEND_PORT/api/health" | grep -q '"database":"ok"' ;;
    frontend) curl -sf --max-time 5 -o /dev/null "http://127.0.0.1:$FRONTEND_PORT/" ;;
  esac
}

# ---------- PostgreSQL ----------

has_cluster() { [ -f "$PGDATA/PG_VERSION" ]; }
pg_running() { has_cluster && pg pg_ctl -D "$PGDATA" status >/dev/null 2>&1; }

ensure_conf() { # loopback only, fixed port; idempotent
  grep -q "^# fightscore-demo" "$PGDATA/postgresql.conf" ||
    printf "\n# fightscore-demo\nlisten_addresses = '127.0.0.1'\nport = %s\n" "$PGPORT" >>"$PGDATA/postgresql.conf"
}

pg_up() {
  ensure_conf
  if ! pg_running; then
    local pid; pid="$(listener_pid "$PGPORT")"
    [ -z "$pid" ] || die "port $PGPORT is used by another process (pid $pid); the demo will not use a foreign database"
    detached wait "" "$(cygpath -m "$PG_BIN/pg_ctl.exe")" -D "$(cygpath -m "$PGDATA")" -l "$(cygpath -m "$HOME_DIR/postgres.log")" -w -t 60 start ||
      die "PostgreSQL did not start, see $HOME_DIR/postgres.log"
  fi
}

psql_q() { # $1 = database, $2 = SQL; password via environment only
  PGPASSWORD="$DB_PASS" pg psql -h 127.0.0.1 -p "$PGPORT" -U "$DB_USER" -d "$1" -v ON_ERROR_STOP=1 -qtAc "$2" </dev/null
}

verify_db() { # the expected cluster, port and database, reached with the stored password
  local got
  got="$(psql_q "$DEMO_DB" "SELECT current_database() || '|' || current_setting('port') || '|' || current_setting('data_directory')" | tr -d '\r')" ||
    die "cannot connect to $DEMO_DB on 127.0.0.1:$PGPORT with the password from $ENV_DEMO"
  [ "$(lower "$got")" = "$(lower "$DEMO_DB|$PGPORT|$(cygpath -m "$PGDATA")")" ] ||
    die "connected database is not the demo cluster (got: ${got%%|*} on another data directory)"
}

# ---------- build ----------

build_backend() { (cd "$ROOT/backend" && npm run build) || die "backend build failed"; }
build_frontend() { (cd "$ROOT/frontend" && NEXT_TELEMETRY_DISABLED=1 npm run build) || die "frontend build failed"; }

build_if_missing() {
  [ -f "$ROOT/backend/dist/main.js" ] || build_backend
  [ -f "$ROOT/frontend/.next/BUILD_ID" ] || build_frontend
}

warn_stale() {
  [ -n "$(find "$ROOT/backend/src" "$ROOT/backend/migrations" -newer "$ROOT/backend/dist/main.js" -type f -print -quit 2>/dev/null)" ] &&
    say "warning: backend sources are newer than the build; run: scripts/demo.sh stop && scripts/demo.sh rebuild"
  [ -n "$(find "$ROOT/frontend/src" "$ROOT/frontend/public" -newer "$ROOT/frontend/.next/BUILD_ID" -type f -print -quit 2>/dev/null)" ] &&
    say "warning: frontend sources are newer than the build; run: scripts/demo.sh stop && scripts/demo.sh rebuild"
  return 0
}

with_db_env() { # an environment variable takes precedence over backend/.env
  (cd "$ROOT/backend" && export DATABASE_URL="$DB_URL" TEST_DATABASE_URL="$TEST_URL" &&
    { [ -z "$DEMO_PW" ] || export DEMO_PASSWORD="$DEMO_PW"; } && "$@")
}

secret() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('base64url'))"; }

demo_pw_location() { # where the demo users' password is kept, for messages (never the value)
  if [ -n "$DEMO_PW" ]; then echo "DEMO_PASSWORD in $ENV_DEMO"; else echo "DEMO_PASSWORD in backend/.env"; fi
}

# ---------- init ----------

# ready | fresh | resume | broken:<reason>
init_state() {
  local env=0 dir=0 cl=0 mk=0
  [ -f "$ENV_DEMO" ] && env=1
  [ -e "$PGDATA" ] && dir=1
  has_cluster && cl=1
  [ -f "$MARKER" ] && mk=1
  if [ $mk = 1 ] && [ $env = 1 ] && [ $cl = 1 ]; then echo ready
  elif [ $mk = 1 ]; then echo "broken:marker present but $([ $env = 0 ] && echo "$ENV_DEMO" || echo "cluster $PGDATA") is missing"
  elif [ $env = 0 ] && [ $dir = 0 ]; then echo fresh
  elif [ $env = 1 ] && { [ $dir = 0 ] || [ $cl = 1 ]; }; then echo resume
  elif [ $env = 0 ]; then echo "broken:$PGDATA exists but $ENV_DEMO (its password) is missing"
  else echo "broken:$PGDATA exists but is not a PostgreSQL cluster"; fi
}

PWFILE=""
cleanup() { [ -n "$PWFILE" ] && rm -f "$PWFILE"; return 0; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

init() {
  local state; state="$(init_state)"
  case "$state" in
    ready) say "Already initialised ($PGDATA). Nothing changed. Use: scripts/demo.sh start"; return 0 ;;
    broken:*)
      die "${state#broken:}. Automatic repair could lose data, so nothing was changed.
  - If this is a failed first setup with no data you need: stop it (scripts/demo.sh stop),
    delete $PGDATA and $ENV_DEMO yourself, then run init again.
  - Otherwise restore the missing file from a backup, or set FS_DEMO_DIR to another folder." ;;
    resume) say "Resuming an unfinished setup (existing data and password are kept)." ;;
  esac
  mkdir -p "$HOME_DIR" "$RUN"

  if [ ! -f "$ENV_DEMO" ]; then # passwords first, so a failure later is always resumable
    write_env "$(secret 18)" "$(secret 12)"
  fi
  read_env
  # A setup started by an older version has no DEMO_PASSWORD here; if backend/.env has none either,
  # the seed cannot have run yet, so generating one now cannot diverge from existing users.
  if [ -z "$DEMO_PW" ] && ! grep -q '^DEMO_PASSWORD=[^[:space:]]' "$ROOT/backend/.env" 2>/dev/null; then
    write_env "$DB_PASS" "$(secret 12)"
    read_env
  fi

  if [ ! -e "$PGDATA" ]; then
    PWFILE="$HOME_DIR/.pw.$$"
    (umask 077; printf '%s' "$DB_PASS" >"$PWFILE")
    pg initdb -D "$PGDATA" -U "$DB_USER" --auth=scram-sha-256 --pwfile="$PWFILE" -E UTF8 --locale=C >/dev/null ||
      die "initdb failed. Run init again after fixing the cause (password in $ENV_DEMO is reused)."
    rm -f "$PWFILE"; PWFILE=""
  fi

  pg_up
  for db in "$DEMO_DB" "$TEST_DB"; do
    [ "$(psql_q postgres "SELECT 1 FROM pg_database WHERE datname = '$db'")" = 1 ] || psql_q postgres "CREATE DATABASE $db" ||
      die "could not create database $db; run init again"
  done
  verify_db
  build_if_missing
  with_db_env node dist/cli/migrate.js || die "migrations failed; fix the cause and run init again"
  with_db_env node dist/cli/seed-demo.js || die "demo seed failed; fix the cause and run init again"
  date -u +%FT%TZ >"$MARKER"
  say "Initialised. Start with: scripts/demo.sh start"
  say "Demo users: demo.organizer, demo.chief, demo.judge (password = $(demo_pw_location))."
}

# ---------- start / stop / status / rebuild ----------

launch() { # $1 = component; leaves a running, verified, healthy process or fails
  local c="$1" port; port="$(port_of "$c")"
  read -r state pid <<<"$(owner "$c")"
  case "$state" in
    foreign) say "FAIL $c: port $port is used by another process (pid $pid: $(cmdline "$pid" | cut -c1-80)). Not started."
      [ "$c" = frontend ] && say "     Stop that process yourself, or use another port: FS_DEMO_WEB_PORT=3100 bash scripts/demo.sh start"
      return 1 ;;
    ours) healthy "$c" && { say "ok   $c already running (pid $pid)"; return 0; }
      say "FAIL $c: running (pid $pid) but not healthy; run scripts/demo.sh stop, then start"; return 1 ;;
  esac
  if [ "$c" = backend ]; then
    # On a non-default web port the backend must accept that origin (CSRF and WebSocket checks). Only this process
    # gets the override; backend/.env is untouched. 3000 stays allowed for a dev server on the default port.
    local origins=""
    [ "$FRONTEND_PORT" = "$DEFAULT_WEB_PORT" ] ||
      origins="http://localhost:$DEFAULT_WEB_PORT,http://127.0.0.1:$DEFAULT_WEB_PORT,http://localhost:$FRONTEND_PORT,http://127.0.0.1:$FRONTEND_PORT"
    (cd "$ROOT/backend" && export DATABASE_URL="$DB_URL" && { [ -z "$origins" ] || export PUBLIC_ORIGINS="$origins"; } &&
      detached nowait "$(cygpath -m "$RUN/backend.log")" node "$BACKEND_ENTRY" "$DEMO_FLAG")
    echo "$FRONTEND_PORT" >"$RUN/backend.web-port"
  else
    (cd "$ROOT/frontend" && NEXT_TELEMETRY_DISABLED=1 detached nowait "$(cygpath -m "$RUN/frontend.log")" \
      node "$FRONTEND_ENTRY" start -H 127.0.0.1 -p "$port" "$ROOT_W/frontend")
  fi
  for _ in $(seq 1 90); do
    read -r state pid <<<"$(owner "$c")"
    if [ "$state" = ours ] && healthy "$c"; then
      echo "$pid" >"$RUN/$c.pid" # Windows PID of the listening process
      say "ok   $c started (pid $pid)"; return 0
    fi
    [ "$state" = foreign ] && { say "FAIL $c: port $port was taken by another process (pid $pid)"; return 1; }
    sleep 1
  done
  say "FAIL $c did not become healthy in 90 s, see $RUN/$c.log:"; tail -n 5 "$RUN/$c.log" | sed 's/^/     /'
  return 1
}

start() {
  [ "$(init_state)" = ready ] || die "demo is not initialised (state: $(init_state)). Run: scripts/demo.sh init"
  read_env
  mkdir -p "$RUN"
  pg_up
  verify_db
  build_if_missing
  warn_stale
  with_db_env node dist/cli/migrate.js >/dev/null || die "migrations failed"
  # A running backend accepts only the web port it was started for.
  local state pid served
  read -r state pid <<<"$(owner backend)"
  served="$(tr -dc '0-9' 2>/dev/null <"$RUN/backend.web-port" || true)"
  if [ "$state" = ours ] && [ "${served:-$DEFAULT_WEB_PORT}" != "$FRONTEND_PORT" ]; then
    die "the running backend serves web port ${served:-$DEFAULT_WEB_PORT}, not $FRONTEND_PORT. Run: scripts/demo.sh stop, then start again"
  fi
  echo "$FRONTEND_PORT" >"$RUN/frontend.port"
  local rc=0
  launch backend || rc=1
  [ $rc = 0 ] && { launch frontend || rc=1; }
  [ $rc = 0 ] && say "FightScore demo is up: http://localhost:$FRONTEND_PORT (logs: $RUN)" ||
    say "Demo is NOT fully up. Fix the problem above; scripts/demo.sh stop stops what was started."
  return $rc
}

stop_component() { # returns 1 only if one of OUR processes could not be stopped
  local c="$1" port pidfile; port="$(port_of "$c")"; pidfile="$RUN/$c.pid"
  read -r state pid <<<"$(owner "$c")"
  # A process from our PID file that is ours but no longer listens (e.g. hung during startup).
  if [ "$state" = free ] && [ -f "$pidfile" ]; then
    local saved; saved="$(tr -dc '0-9' <"$pidfile")"
    if [ -n "$saved" ] && is_ours "$c" "$saved"; then state=ours; pid="$saved"; fi
  fi
  case "$state" in
    free) rm -f "$pidfile"; say "ok   $c not running"; return 0 ;;
    foreign) rm -f "$pidfile"; say "warn $c: port $port is held by another process (pid $pid), left running"; return 0 ;;
  esac
  taskkill //PID "$pid" //T //F >/dev/null 2>&1 || true # only after the command line was verified
  if wait_free "$port" && [ -z "$(cmdline "$pid")" ]; then rm -f "$pidfile"; say "ok   $c stopped (pid $pid)"; return 0; fi
  say "FAIL $c (pid $pid) could not be stopped; stop it manually"; return 1
}

stop() {
  local rc=0
  stop_component frontend || rc=1
  stop_component backend || rc=1
  if pg_running; then
    pg pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null 2>&1 && say "ok   postgres stopped (data kept in $PGDATA)" ||
      { say "FAIL postgres did not stop"; rc=1; }
  else say "ok   postgres not running"; fi
  return $rc
}

status() {
  local rc=0 state pid
  say "init:     $(init_state)"
  if pg_running; then say "postgres: running on 127.0.0.1:$PGPORT ($PGDATA)"
  else say "postgres: stopped"; rc=1; fi
  for c in backend frontend; do
    read -r state pid <<<"$(owner "$c")"
    case "$state" in
      ours) if healthy "$c"; then printf '%-9s running (pid %s)\n' "$c:" "$pid"; else printf '%-9s running but NOT healthy (pid %s)\n' "$c:" "$pid"; rc=1; fi ;;
      foreign) printf '%-9s port %s used by ANOTHER process (pid %s)\n' "$c:" "$(port_of "$c")" "$pid"; rc=1 ;;
      free) printf '%-9s stopped\n' "$c:"; rc=1 ;;
    esac
  done
  return $rc
}

rebuild() {
  for c in backend frontend; do
    read -r state pid <<<"$(owner "$c")"
    [ "$state" = ours ] && die "$c is running (pid $pid). Run scripts/demo.sh stop first."
  done
  build_backend
  build_frontend
  say "Rebuilt backend and frontend. Start with: scripts/demo.sh start"
}

case "${1:-}" in
  init) init ;;
  start) start ;;
  stop) stop ;;
  status) status ;;
  rebuild) rebuild ;;
  *) say "Usage: scripts/demo.sh init | start | stop | status | rebuild"; exit 2 ;;
esac
