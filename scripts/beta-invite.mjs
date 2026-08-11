#!/usr/bin/env node
/**
 * Founding Family Beta invite admin tool. Connects directly to DATABASE_URL
 * (same pattern as db/migrate.mjs) rather than going through the app —
 * there's no admin UI for this, by design (10 invites, one-time setup).
 *
 * Prints the raw invite link ONCE, at creation time. Only its SHA-256 hash
 * is ever stored (see src/lib/repos/betaInvite.ts) — if you lose the
 * printed link, `create` again for the same email rather than looking for
 * a way to recover it; there isn't one.
 *
 * `create` requires APP_BASE_URL (or NEXT_PUBLIC_SITE_URL) to be set to the
 * TARGET environment's real URL — it never falls back to localhost or any
 * placeholder, so a link can't accidentally go out pointing at the wrong
 * place. See src/lib/appUrl.ts for the app-runtime equivalent.
 *
 * Usage:
 *   DATABASE_URL=postgres://... APP_BASE_URL=https://www.dearlyhere.com node scripts/beta-invite.mjs create <email>
 *   DATABASE_URL=postgres://... node scripts/beta-invite.mjs list
 *   DATABASE_URL=postgres://... node scripts/beta-invite.mjs revoke <invite-id>
 */
import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';

const [, , cmd, arg] = process.argv;
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. See .env.example.');
  process.exit(1);
}

// Kept in sync by hand with src/lib/validation.ts EMAIL_RE and
// src/lib/foundingBeta.ts's bounds — this script intentionally has no
// dependency on the compiled app (see db/migrate.mjs for the same tradeoff).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 365;
const TOKEN_BYTES = 32;

function hashToken(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

function betaDays() {
  const n = Number(process.env.FOUNDING_FAMILY_BETA_DAYS);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_DAYS) return DEFAULT_DAYS;
  return n;
}

/**
 * Same precedence and validation as src/lib/appUrl.ts's getAppBaseUrl
 * (APP_BASE_URL, falling back to the older NEXT_PUBLIC_SITE_URL), but
 * stricter: this is an operator tool that mints a real link for a real
 * family, so unlike app runtime code it NEVER falls back to localhost or
 * any placeholder in any environment — if neither var is set, it refuses to
 * generate a link at all rather than risk silently mailing someone a
 * localhost URL. Run against a target environment's DATABASE_URL WITH that
 * environment's own APP_BASE_URL set (see docs/founding-family-beta.md).
 */
function resolveAppBaseUrl() {
  const configured = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) {
    throw new Error(
      'APP_BASE_URL (or NEXT_PUBLIC_SITE_URL) is not set. Refusing to generate an invite link without an ' +
        'explicit target URL — set APP_BASE_URL to this environment\'s real URL ' +
        '(e.g. https://www.dearlyhere.com for production, or your Preview deployment URL) and try again.',
    );
  }
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(`APP_BASE_URL (or NEXT_PUBLIC_SITE_URL) is set to "${configured}", which is not a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`APP_BASE_URL (or NEXT_PUBLIC_SITE_URL) must be an http(s) URL — got "${configured}".`);
  }
  return parsed.toString().replace(/\/+$/, '');
}

async function main() {
  const client = new pg.Client({
    connectionString: url,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
  });
  await client.connect();

  if (cmd === 'create') {
    const email = (arg ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      console.error('Usage: node scripts/beta-invite.mjs create <email>');
      process.exitCode = 1;
      await client.end();
      return;
    }
    // Validated BEFORE the INSERT — a misconfigured/missing base URL must
    // fail fast, not consume a one-time invite row we then can't print a
    // usable link for.
    let siteUrl;
    try {
      siteUrl = resolveAppBaseUrl();
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
      await client.end();
      return;
    }
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + betaDays() * 24 * 60 * 60 * 1000);
    const { rows } = await client.query(
      `INSERT INTO beta_invites (email_normalized, token_hash, expires_at)
       VALUES ($1, $2, $3) RETURNING id, expires_at`,
      [email, hashToken(token), expiresAt.toISOString()],
    );
    console.log(`Invite ${rows[0].id} created for ${email}, expires ${rows[0].expires_at}.`);
    console.log('Raw link — shown once, send it now (it cannot be recovered later):');
    console.log(`${siteUrl}/app/onboarding?invite=${token}`);
  } else if (cmd === 'list') {
    const { rows } = await client.query(
      `SELECT id, email_normalized, status, expires_at, redeemed_at, created_at
         FROM beta_invites ORDER BY created_at DESC`,
    );
    if (rows.length === 0) {
      console.log('No beta invites yet.');
    } else {
      console.table(rows);
    }
  } else if (cmd === 'revoke') {
    if (!arg) {
      console.error('Usage: node scripts/beta-invite.mjs revoke <invite-id>');
      process.exitCode = 1;
      await client.end();
      return;
    }
    const { rows } = await client.query(
      `UPDATE beta_invites SET status = 'revoked', updated_at = now()
        WHERE id = $1 AND status = 'pending' RETURNING id`,
      [arg],
    );
    console.log(
      rows.length
        ? `Revoked ${rows[0].id}.`
        : 'No pending invite with that id (it may already be redeemed, expired, revoked, or not exist).',
    );
  } else {
    console.error('Usage: node scripts/beta-invite.mjs <create|list|revoke> [args]');
    process.exitCode = 1;
  }

  await client.end();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
