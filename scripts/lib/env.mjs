// Load env files the same way `next dev` does (.env.development.local,
// .env.local, .env.development, .env), so the local scripts see exactly
// the configuration the app sees. Values already in process.env win.
import nextEnv from '@next/env';

export function loadLocalEnv(dir = process.cwd()) {
  const quiet = { info() {}, error: (...a) => console.error(...a) };
  nextEnv.loadEnvConfig(dir, process.env.NODE_ENV !== 'production', quiet);
}

/** Host name only — never print the whole DATABASE_URL (it holds a password). */
export function dbHostOf(url) {
  try {
    return new URL(url).hostname || '(none)';
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

/** pg ssl option, mirroring src/lib/db.ts: PGSSL=disable for a local non-SSL Postgres. */
/** @param {Record<string, string | undefined>} [env] */
export function sslOption(env = process.env) {
  return env.PGSSL === 'disable' ? false : { rejectUnauthorized: true };
}
