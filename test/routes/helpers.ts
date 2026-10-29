import { NextRequest } from 'next/server';
import type { Querier } from '../../src/lib/querier';
import { signSession, SESSION_COOKIE } from '../../src/lib/session';

/**
 * Insert a bare buyer (email only, no password) — for route tests that just
 * need an owning user id. The email counts as confirmed, like any account that
 * has finished signing up; pass { verified: false } to test the unconfirmed state.
 */
export async function makeBuyer(q: Querier, email: string, opts: { verified?: boolean } = {}): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email, email_verified_at) VALUES ($1, $2) RETURNING id`,
    [email, opts.verified === false ? null : new Date()],
  );
  return rows[0].id;
}

type ReqInit = { method?: string; body?: BodyInit; headers?: Record<string, string> };

/**
 * Build a NextRequest carrying a signed session cookie for the given user id
 * (or an unauthenticated request when userId is null). Pass `{ isAdmin: true }`
 * for admin-gated routes.
 */
export function authedReq(
  url: string,
  userId: string | null,
  init: ReqInit = {},
  opts: { isAdmin?: boolean } = {},
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers ?? {}) };
  if (userId) headers.cookie = `${SESSION_COOKIE}=${signSession(userId, { isAdmin: opts.isAdmin ?? false })}`;
  return new NextRequest(url, { ...init, headers });
}
