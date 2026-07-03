import { NextRequest } from 'next/server';
import type { Querier } from './querier';
import { accessTokenRepo } from './repos/accessToken';
import { NotFoundError, ValidationError } from './types';
import { SESSION_COOKIE, verifySession } from './session';

/** Parse a JSON request body, mapping malformed JSON to a 400 (not a 500). */
export async function readJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }
}

/**
 * Resolve the current buyer's user id from the verified session cookie. The
 * cookie is HMAC-signed (see session.ts), so a client cannot forge it — this
 * replaces the old spoofable `x-kindly-buyer` header shim.
 */
export function getBuyerId(req: NextRequest): string | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value)?.uid ?? null;
}

/**
 * Resolve the current admin's user id — the session must be valid AND carry the
 * admin claim (set at login from users.is_admin). Non-admins resolve to null.
 */
export function getAdminId(req: NextRequest): string | null {
  const claims = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  return claims?.adm ? claims.uid : null;
}

/**
 * Extract the raw parent talk token from the request. Accepts an
 * `Authorization: Bearer <token>` header or an `x-kindly-parent-token` header.
 * The caller resolves it to a parent via accessTokenRepo — never trust a
 * parent_id from the body.
 */
export function getParentToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim() || null;
  return req.headers.get('x-kindly-parent-token');
}

/**
 * Resolve the caller to a parent_id from their talk token, or null when the
 * token is missing/invalid/expired (→ 401). A real DB error propagates so the
 * route surfaces a 500 rather than masquerading as unauthorized.
 */
export async function resolveParentFromRequest(
  req: NextRequest,
  q: Querier,
): Promise<string | null> {
  const token = getParentToken(req);
  if (!token) return null;
  try {
    return await accessTokenRepo.resolveParentId(q, token);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

/** Map a thrown domain error to an HTTP status + safe message. */
export function errorToResponse(err: unknown): { status: number; body: { error: { code: string; message: string } } } {
  const name = err instanceof Error ? err.name : 'Error';
  switch (name) {
    case 'NotFoundError':
      return { status: 404, body: { error: { code: 'not_found', message: 'Not found.' } } };
    case 'ForbiddenError':
      return { status: 403, body: { error: { code: 'forbidden', message: (err as Error).message } } };
    case 'ConflictError':
      return { status: 409, body: { error: { code: 'conflict', message: (err as Error).message } } };
    case 'AiError':
      // Upstream model failure (refusal, empty, truncated, network) — not a bug
      // in our server. Surface as 502 so callers can distinguish + retry.
      return { status: 502, body: { error: { code: 'model_unavailable', message: 'The companion is unavailable right now.' } } };
    case 'PreconditionError':
      return { status: 409, body: { error: { code: 'precondition_failed', message: (err as Error).message } } };
    case 'ValidationError':
      return { status: 400, body: { error: { code: 'invalid_input', message: (err as Error).message } } };
    default:
      console.error('Unhandled error', err);
      return { status: 500, body: { error: { code: 'server_error', message: 'Something went wrong.' } } };
  }
}
