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

async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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
  get: <T>(path: string) => request<T>(path, 'GET'),
  post: <T>(path: string, body?: unknown) => request<T>(path, 'POST', body),
  patch: <T>(path: string, body?: unknown) => request<T>(path, 'PATCH', body),
  del: <T>(path: string, body?: unknown) => request<T>(path, 'DELETE', body),
};
