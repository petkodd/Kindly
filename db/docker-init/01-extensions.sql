-- Runs once, the first time the local Docker volume is created
-- (docker-compose.yml mounts this folder at /docker-entrypoint-initdb.d).
-- db/migrations/0001_init.sql also creates these, so this only guarantees
-- the extensions exist before the app's first migration.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
