import { Pool, PoolClient, types } from 'pg';

/**
 * node-postgres parses DATE columns (oid 1082) into JS Date objects by
 * default, silently dropping the plain 'YYYY-MM-DD' the column actually
 * stores — and reconstructing a string back from that Date is
 * timezone-dependent (it's parsed as local midnight, so reading it back via
 * UTC methods is off by a day in any timezone ahead of UTC). Keep DATE
 * columns as the raw string every time, for every table, so no repo has to
 * hand-roll its own normalization. Registered once at module load, before
 * any pool is created.
 */
types.setTypeParser(types.builtins.DATE, (value) => value);

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
      // Managed Postgres providers (Neon/Supabase/RDS) present certs chained to
      // publicly trusted roots, so verification just works — disabling it would
      // accept ANY certificate and defeat TLS's protection against a MITM'd
      // connection. Local dev without SSL at all uses PGSSL=disable instead.
      ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
      max: 5,
    });
  }
  return pool;
}

/**
 * Run `fn` inside a real, single-connection transaction: BEGIN, then COMMIT
 * on success or ROLLBACK on any thrown error, always releasing the client
 * back to the pool. Use this whenever two or more writes must succeed or
 * fail together (e.g. redeeming a one-time invite together with granting the
 * entitlement it unlocks — see the Founding Family Beta activation route) —
 * a bare `pool.query()` per statement auto-commits each one independently
 * and gives no such guarantee.
 *
 * `PoolClient` satisfies `Querier` (see ./querier.ts) structurally, so `fn`
 * can pass its client straight into any existing repo function unchanged.
 *
 * Note for tests: pg-mem's `Pool.connect()`-based client accepts
 * BEGIN/COMMIT/ROLLBACK without error, but does not actually discard writes
 * on ROLLBACK (verified against pg-mem 3.0.3 — its wire-protocol adapter
 * forks a snapshot on BEGIN but executes queries against the live store
 * regardless, so ROLLBACK has nothing to restore). Tests that exercise this
 * helper therefore cannot assert "a mid-transaction failure left no trace" —
 * only real Postgres proves that (validated manually; see
 * docs/founding-family-beta.md). What tests CAN and do assert against
 * pg-mem: the same failure never leaves a *permanently unrecoverable* state —
 * a retry with the same caller+invite always converges to exactly one
 * entitlement (see betaActivate.route.test.ts's recovery tests).
 */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Best-effort — if the connection is already broken, releasing it
      // below still hands it back for the pool to discard/replace.
    }
    throw err;
  } finally {
    client.release();
  }
}
