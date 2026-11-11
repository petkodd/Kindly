/**
 * Where to send someone after sign-up / sign-in. A `next` value comes from the
 * URL (or the signup body), so it is untrusted: only same-site paths inside
 * the buyer app or the admin area are accepted — never another origin
 * (`//evil.example`, `https://…`, `/\evil`), never the parent's talk screen
 * (a buyer must not land on /app/talk), and never back onto an auth page.
 *
 * Pure and dependency-free so the edge middleware, server routes and client
 * components can all share it.
 */
const MAX_NEXT_LENGTH = 512;

export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const next = raw.trim();
  if (!next || next.length > MAX_NEXT_LENGTH) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  // Control characters (incl. tab/newline, which browsers strip) could smuggle a scheme.
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  let url: URL;
  try {
    url = new URL(next, 'https://dearly.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://dearly.invalid') return null;
  const path = url.pathname;
  const inApp = path === '/app' || path.startsWith('/app/');
  const inAdmin = path === '/admin' || path.startsWith('/admin/');
  if (!inApp && !inAdmin) return null;
  if (path === '/app/talk' || path.startsWith('/app/talk/')) return null;
  return `${path}${url.search}${url.hash}`;
}

/** The path a gift CTA links to: sign up first, then continue to `next`. */
export function signupHref(next = '/app/onboarding'): string {
  return `/signup?next=${encodeURIComponent(next)}`;
}

/** Append a validated `next` to an auth page link (login ⇄ signup), or return the bare path. */
export function withNext(path: '/login' | '/signup', next: string | null | undefined): string {
  const safe = safeNextPath(next);
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path;
}
