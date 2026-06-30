import { NextRequest } from 'next/server';

/**
 * Alpha auth shim. Resolves the current buyer's user id.
 *
 * ⚠️ REPLACE on feature/parent-profile (auth): this currently trusts a
 * `x-kindly-buyer` header / `buyer` cookie for local development only.
 * Production must derive identity from a verified session — never from a
 * client-supplied id used for authorization.
 */
export function getBuyerId(req: NextRequest): string | null {
  const header = req.headers.get('x-kindly-buyer');
  if (header) return header;
  const cookie = req.cookies.get('buyer')?.value;
  return cookie ?? null;
}

/** Map a thrown domain error to an HTTP status + safe message. */
export function errorToResponse(err: unknown): { status: number; body: { error: { code: string; message: string } } } {
  const name = err instanceof Error ? err.name : 'Error';
  switch (name) {
    case 'NotFoundError':
      return { status: 404, body: { error: { code: 'not_found', message: 'Not found.' } } };
    case 'PreconditionError':
      return { status: 409, body: { error: { code: 'precondition_failed', message: (err as Error).message } } };
    case 'ValidationError':
      return { status: 400, body: { error: { code: 'invalid_input', message: (err as Error).message } } };
    default:
      console.error('Unhandled error', err);
      return { status: 500, body: { error: { code: 'server_error', message: 'Something went wrong.' } } };
  }
}
