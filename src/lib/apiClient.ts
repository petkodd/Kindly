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

async function request<T>(path: string, method: string, body?: unknown, headers?: Extra, signal?: AbortSignal): Promise<T> {
  const merged: Record<string, string> = { ...(headers ?? {}) };
  if (body !== undefined) merged['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    headers: Object.keys(merged).length > 0 ? merged : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
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
  get: <T>(path: string, headers?: Extra, signal?: AbortSignal) => request<T>(path, 'GET', undefined, headers, signal),
  post: <T>(path: string, body?: unknown, headers?: Extra) => request<T>(path, 'POST', body, headers),
  patch: <T>(path: string, body?: unknown, headers?: Extra) => request<T>(path, 'PATCH', body, headers),
  del: <T>(path: string, body?: unknown, headers?: Extra) => request<T>(path, 'DELETE', body, headers),
};

/**
 * Grant the CURRENT browser talk access to a self-use profile: the same
 * access-link -> /api/talk/auth handshake a gift recipient performs manually
 * via a shared link, just automated, since the buyer IS the talker. Used by
 * both the onboarding self-flow and the parent-profile "Talk to Dearly"
 * re-entry button — kept in one place so the two call sites can't drift.
 * `keep_existing` avoids revoking another device's already-authenticated
 * session for the same self profile (see the access-link route's doc comment).
 */
export async function grantSelfTalkAccess(parentId: string): Promise<void> {
  const { token } = await api.post<{ token: string }>(`/api/parents/${parentId}/access-link`, { keep_existing: true });
  await api.post('/api/talk/auth', { token });
}

const PARENTS_CACHE_KEY = 'dearly:post-login-parents-cache';
const PARENTS_CACHE_TTL_MS = 10_000;

/**
 * Stash the parents list resolvePostLoginPath just fetched so the
 * onboarding page's own resume check (a moment later, same navigation)
 * doesn't re-fetch identical data. sessionStorage only — never sent over
 * the network, never in a URL. Best-effort: if storage is unavailable
 * (private browsing, disabled), onboarding just falls back to its own
 * fetch, no harm done.
 */
function cacheParentsForOnboarding(parents: unknown): void {
  try {
    sessionStorage.setItem(PARENTS_CACHE_KEY, JSON.stringify({ parents, cachedAt: Date.now() }));
  } catch {
    /* storage unavailable — fine, onboarding will just fetch its own copy */
  }
}

/**
 * One-shot read of the cache above. Always removes the entry (so it can
 * never be read twice, or served stale across a later, unrelated visit)
 * and ignores anything older than PARENTS_CACHE_TTL_MS.
 */
export function takeCachedParentsForOnboarding<T>(): T[] | null {
  try {
    const raw = sessionStorage.getItem(PARENTS_CACHE_KEY);
    sessionStorage.removeItem(PARENTS_CACHE_KEY);
    if (!raw) return null;
    const { parents, cachedAt } = JSON.parse(raw) as { parents: T[]; cachedAt: number };
    if (typeof cachedAt !== 'number' || Date.now() - cachedAt > PARENTS_CACHE_TTL_MS) return null;
    return parents;
  } catch {
    return null;
  }
}

/**
 * Where to land a buyer right after login/signup: straight to the product
 * (family-summary) if they already have an activated parent, or back into
 * the onboarding wizard — which has its own resume logic for an
 * incomplete-but-unactivated parent — otherwise. Never /app/account; that's
 * a settings page, not a landing page. Defaults to onboarding on any lookup
 * failure (including a timeout — the lookup is bounded so this can never
 * hang the caller indefinitely) so a flaky /api/parents call never strands
 * the buyer. onboarding's own resume effect double-checks for an already-
 * activated parent and bounces back out to /app/family-summary, so this
 * fallback can't leave an already-onboarded buyer stuck creating a
 * duplicate profile.
 */
export async function resolvePostLoginPath(): Promise<string> {
  try {
    const { parents } = await api.get<{ parents: { activated_at?: string | null }[] }>(
      '/api/parents',
      undefined,
      AbortSignal.timeout(8000),
    );
    const hasActivatedParent = parents.some((p) => !!p.activated_at);
    if (hasActivatedParent) return '/app/family-summary';
    cacheParentsForOnboarding(parents);
    return '/app/onboarding';
  } catch {
    return '/app/onboarding';
  }
}
