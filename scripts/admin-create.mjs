#!/usr/bin/env node
// npm run admin:create -- <email> --confirm
//
// Promotes an EXISTING user (sign up first) to admin by setting
// users.is_admin = true. Works against whatever DATABASE_URL is configured
// (env, or .env.local like `next dev`), so it always names the database host
// first and does nothing without --confirm. It prints only the host name —
// never the full DATABASE_URL. The user must log out and back in to get the
// admin session.
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadLocalEnv, dbHostOf, sslOption } from './lib/env.mjs';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/; // kept in sync with src/lib/validation.ts

/**
 * @param {string[]} argv
 * @returns {{ email?: string, confirm?: boolean, error?: string }}
 */
export function parseArgs(argv) {
  const confirm = argv.includes('--confirm');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const unknown = argv.filter((a) => a.startsWith('--') && a !== '--confirm');
  if (unknown.length) return { error: `Unknown option: ${unknown.join(' ')}` };
  if (positional.length !== 1 || !EMAIL_RE.test(positional[0])) {
    return { error: 'Usage: npm run admin:create -- <email> --confirm' };
  }
  return { email: positional[0].trim(), confirm };
}

/**
 * @param {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} q
 * @param {string} email
 * @returns {Promise<'promoted' | 'already_admin' | 'not_found'>}
 */
export async function promoteToAdmin(q, email) {
  const { rows } = await q.query(
    `SELECT id, is_admin FROM users WHERE email = $1 AND deleted_at IS NULL`,
    [email],
  );
  if (!rows[0]) return 'not_found';
  if (rows[0].is_admin) return 'already_admin';
  await q.query(`UPDATE users SET is_admin = true WHERE id = $1`, [rows[0].id]);
  await q.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, meta)
     VALUES (NULL, 'admin_promote', 'user', $1, $2)`,
    [rows[0].id, JSON.stringify({ via: 'scripts/admin-create.mjs' })],
  );
  return 'promoted';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    process.exit(1);
  }
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }
  const host = dbHostOf(url);
  if (!args.confirm) {
    console.log(`Would promote ${args.email} to admin on database host "${host}".`);
    console.log('Nothing changed. Re-run with --confirm to apply.');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url, ssl: sslOption() });
  await client.connect();
  try {
    const result = await promoteToAdmin(client, args.email);
    if (result === 'not_found') {
      console.error(`✗ No active user with that email on "${host}". Sign up first, then re-run.`);
      process.exitCode = 1;
    } else if (result === 'already_admin') {
      console.log(`• ${args.email} is already an admin on "${host}".`);
    } else {
      console.log(`✓ ${args.email} is now an admin on "${host}". Log out and back in to open /admin.`);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  });
}
