/**
 * Tiny browser-side fetch helper. Same-origin only (CSP connect-src 'self'), so
 * the session cookie rides along automatically. Parses the JSON error envelope
 * ({ error: { code, message } }) into a thrown Error with a readable message.
 */
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Optional extra headers — used by the parent-facing talk flow, which
 * authenticates with an `Authorization: Bearer <access-token>` header rather
 * than the buyer session cookie.
 */
type Extra = Record<string, string> | undefined;

async function request<T>(path: string, method: string, body?: unknown, headers?: Extra): Promise<T> {
  const merged: Record<string, string> = { ...(headers ?? {}) };
  if (body !== undefined) merged['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers: Object.keys(merged).length > 0 ? merged : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // no/'' body
  }
  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? 'Something went wrong.');
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, headers?: Extra) => request<T>(path, 'GET', undefined, headers),
  post: <T>(path: string, body?: unknown, headers?: Extra) => request<T>(path, 'POST', body, headers),
  patch: <T>(path: string, body?: unknown, headers?: Extra) => request<T>(path, 'PATCH', body, headers),
  del: <T>(path: string, body?: unknown, headers?: Extra) => request<T>(path, 'DELETE', body, headers),
};
