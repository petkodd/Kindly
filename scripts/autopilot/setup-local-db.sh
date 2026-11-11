#!/usr/bin/env bash
# Autopilot: start a throwaway LOCAL Postgres 16 (+pgvector, citext) for
# migrations, seed and browser checks inside a cloud session.
# Never points at any remote database. Prints the DATABASE_URL to use.
set -euo pipefail
PORT="${PGPORT_LOCAL:-5432}"
DATA="${PGDATA_LOCAL:-/tmp/autopilot-pgdata}"
BIN=/usr/lib/postgresql/16/bin

if [ ! -x "$BIN/pg_ctl" ]; then
  echo "Installing postgresql-16 + pgvector…" >&2
  (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-16 postgresql-16-pgvector) >&2 \
    || { echo "Could not install Postgres; fall back to pg-mem tests and say so in the PR." >&2; exit 2; }
fi

run_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }

if [ ! -f "$DATA/PG_VERSION" ]; then
  mkdir -p "$DATA"; [ "$(id -u)" = 0 ] && chown postgres "$DATA"
  run_pg "$BIN/initdb -D $DATA -U postgres --auth=trust >/dev/null"
fi
run_pg "$BIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l $DATA/pg.log status >/dev/null" \
  || run_pg "$BIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp' -l $DATA/pg.log -w start >/dev/null"

psql_() { psql -h /tmp -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -qtAc "$1"; }
psql_ "SELECT 1 FROM pg_roles WHERE rolname='kindly'" | grep -q 1 || psql_ "CREATE ROLE kindly LOGIN SUPERUSER PASSWORD 'kindly'"
psql_ "SELECT 1 FROM pg_database WHERE datname='kindly'" | grep -q 1 || psql_ "CREATE DATABASE kindly OWNER kindly"
PGOPTIONS="-c client_min_messages=warning" psql -h /tmp -p "$PORT" -U postgres -d kindly -qc "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS citext;" >/dev/null
echo "postgres://kindly:kindly@localhost:$PORT/kindly"
