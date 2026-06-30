import { Pool } from 'pg';

/**
 * Single shared pg Pool. On Vercel, set DATABASE_URL to a Postgres
 * instance with the pgvector extension enabled (e.g. Neon, Supabase, RDS).
 *
 * Authorization rule (see api_plan_v1.md): parent_id must always be resolved
 * from the authenticated identity or a valid access token — never trusted
 * from the client body. Cross-tenant access returns 404, not 403.
 */
let pool: Pool | undefined;

export function db(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. See .env.example.');
    }
    pool = new Pool({
      connectionString,
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}
