import { newDb } from 'pg-mem';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Querier } from '../src/lib/querier';

/**
 * Build an in-memory database from the REAL migration so tests exercise the
 * same SQL that ships. pg-mem doesn't support pgvector or a few Postgres
 * builtins, so we register no-op shims and strip the parts it can't parse
 * (the vector column + its ANN index) — none of which affect the consent /
 * profile / memory logic under test.
 */
export function makeTestDb(): Querier {
  const db = newDb();

  // Shims for functions pg-mem doesn't implement.
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid' as never,
    implementation: () => crypto.randomUUID(),
    impure: true,
  });
  db.public.registerFunction({
    name: 'now',
    returns: 'timestamptz' as never,
    implementation: () => new Date(),
    impure: true,
  });

  // Apply every migration in order, just like db/migrate.mjs ships them.
  const migrationsDir = join(__dirname, '../db/migrations');
  let sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(migrationsDir, f), 'utf8'))
    .join('\n');

  // Remove pgvector-specific bits pg-mem can't parse.
  sql = sql
    .replace(/CREATE EXTENSION IF NOT EXISTS "vector";/g, '')
    .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g, '')
    .replace(/CREATE EXTENSION IF NOT EXISTS "citext";/g, '')
    .replace(/^\s*embedding\s+vector\(1536\),.*$/gm, '') // drop embedding column (+ inline comment)
    .replace(/CREATE INDEX idx_memories_embedding[\s\S]*?;/g, '') // drop ANN index
    .replace(/CITEXT/g, 'TEXT'); // pg-mem has no citext

  db.public.none(sql);

  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return pool as unknown as Querier;
}
