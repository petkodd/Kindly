// TLS policy for db/migrate.mjs (production migrations run from CI).
//
// - Certificates are ALWAYS verified (rejectUnauthorized: true). Managed
//   Postgres providers (Neon/Supabase/RDS) chain to publicly trusted roots, so
//   this works with no extra config.
// - PGSSLROOTCERT=/path/to/ca.pem adds a private CA (e.g. RDS/self-hosted),
//   same variable name libpq uses. A missing/unreadable file is a hard error:
//   we never silently fall back to an unverified connection.
// - PGSSL=disable turns TLS off entirely (local Docker Postgres only).
// - ssl* query params in DATABASE_URL (sslmode=no-verify, sslrootcert=...) are
//   stripped: pg lets the URL override the `ssl` object, which would let a URL
//   quietly disable verification. The env vars above are the only knobs.
import { readFileSync } from 'node:fs';

const URL_SSL_PARAMS = ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword', 'uselibpqcompat'];

/**
 * @param {Record<string, string | undefined>} env
 * @param {(path: string) => string | Buffer} [readFile]
 * @returns {false | { rejectUnauthorized: true, ca?: string | Buffer }}
 */
export function pgSslConfig(env, readFile = (p) => readFileSync(p)) {
  if (env.PGSSL === 'disable') return false;
  const caPath = env.PGSSLROOTCERT?.trim();
  if (!caPath) return { rejectUnauthorized: true };
  let ca;
  try {
    ca = readFile(caPath);
  } catch (err) {
    throw new Error(`PGSSLROOTCERT is set but the CA file could not be read (${err?.code ?? 'error'}).`);
  }
  if (!String(ca).includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('PGSSLROOTCERT does not point to a PEM certificate.');
  }
  return { rejectUnauthorized: true, ca };
}

/**
 * Removes ssl-related query params from a postgres URL.
 * @param {string} connectionString
 * @returns {{ connectionString: string, stripped: string[] }}
 */
export function stripUrlSslParams(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return { connectionString, stripped: [] };
  }
  const stripped = URL_SSL_PARAMS.filter((k) => url.searchParams.has(k));
  for (const k of stripped) url.searchParams.delete(k);
  return { connectionString: stripped.length ? url.toString() : connectionString, stripped };
}
