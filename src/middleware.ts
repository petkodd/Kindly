import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionEdge } from '@/lib/sessionEdge';
import { safeNextPath } from '@/lib/nextPath';
import { normalizeReferralCode, REF_COOKIE, REF_COOKIE_MAX_AGE_S } from '@/lib/referralCode';
import { siteUrl } from '@/lib/seo';

// Must match SESSION_COOKIE in src/lib/session.ts (not imported: that module
// pulls in node:crypto, which the edge runtime doesn't have).
const SESSION_COOKIE = 'kindly_session';

/**
 * Page-level redirects for signed-in / signed-out visitors (chat 10).
 *
 * - Signed-out visits to /app/* go to /signup?next=…, so a gift CTA or a
 *   bookmarked app page never dead-ends on "Sign in required". /app/talk is
 *   exempt: the parent reaches it with their own talk link, never a buyer
 *   account — a parent must never be locked out.
 * - Signed-out visits to /admin go to /login; signed-in non-admins go to the app.
 * - A signed-in buyer opening /login or /signup goes straight on to `next`
 *   (when safe) or the app. Only those two exact pages: /login/verify,
 *   /login/forgot and /login/reset must keep working while signed in.
 *
 * The middleware only sees the signed cookie, not revocation (see
 * sessionEdge.ts). A revoked-but-signed cookie is cleared by the app's 401
 * handling (signOutAndRedirect in apiClient.ts), so it can't bounce forever.
 * API routes are never redirected here; they authenticate with resolveBuyer.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // SEO-2: API routes (cron jobs, the Stripe webhook included) are never
  // redirected, on any host; they authenticate themselves. The noindex header
  // actually reaches clients via next.config.mjs (Next drops middleware
  // response headers on route-handler responses); it's set here as well.
  if (isApiPath(pathname)) {
    const res = NextResponse.next();
    res.headers.set('X-Robots-Tag', 'noindex');
    return res;
  }
  const canonical = canonicalHostRedirect(req);
  const res = canonical ?? (isAuthRoutedPath(pathname) ? await route(req) : NextResponse.next());
  // Chat 11: remember a ?ref=CODE referral code for 30 days (any page).
  const ref = isPagePath(pathname) ? normalizeReferralCode(req.nextUrl.searchParams.get('ref')) : null;
  if (ref) {
    res.cookies.set(REF_COOKIE, ref, {
      maxAge: REF_COOKIE_MAX_AGE_S,
      path: '/',
      sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:',
    });
  }
  return res;
}

const isApiPath = (p: string) => p === '/api' || p.startsWith('/api/');
/** Pages only: not API, not Next internals, not files like /og/default.png (the chat 11 ref rule). */
const isPagePath = (p: string) => !isApiPath(p) && !p.startsWith('/_next') && !/\/[^/]*\.[^/]*$/.test(p);
const isAuthRoutedPath = (p: string) =>
  p === '/login' || p === '/signup' || p === '/app' || p.startsWith('/app/') || p === '/admin' || p.startsWith('/admin/');

/**
 * SEO-2: the site answers on one host only. In the Vercel production
 * deployment, a request on any other host (the `*.vercel.app` alias, `www.`
 * vs the apex) gets a 308 to the same path and query on the canonical host
 * from `siteUrl()`. Preview and development deployments, local `next start`
 * and tests (no `VERCEL_ENV=production`) are never redirected. Reads the
 * `host` header (Vercel sets it to the requested domain); `x-forwarded-host`
 * is client-controlled in front of other proxies, so it is not trusted here.
 */
function canonicalHostRedirect(req: NextRequest): NextResponse | null {
  if (process.env.VERCEL_ENV !== 'production') return null;
  let canonical: URL;
  try {
    canonical = new URL(siteUrl());
  } catch {
    return null; // unreachable: the build guard (siteUrlGuard.mjs) requires a valid URL
  }
  const host = (req.headers.get('host') ?? req.nextUrl.host).split(',')[0].trim().toLowerCase();
  if (!host || host === canonical.host.toLowerCase()) return null;
  const { pathname, search } = req.nextUrl;
  return NextResponse.redirect(new URL(`${pathname}${search}`, canonical.origin), 308);
}

async function route(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  const claims = await verifySessionEdge(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === '/login' || pathname === '/signup') {
    if (!claims) return NextResponse.next();
    const next = safeNextPath(req.nextUrl.searchParams.get('next'));
    const fallback = claims.adm && pathname === '/login' ? '/admin' : '/app/onboarding';
    return redirect(req, next ?? fallback);
  }

  if (pathname === '/app/talk' || pathname.startsWith('/app/talk/')) return NextResponse.next();

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    // A signed-in non-admin has no business here; send them to their own app.
    // (The page and every admin API still check the live is_admin flag.)
    if (claims) return claims.adm ? NextResponse.next() : redirect(req, '/app/onboarding');
    return redirect(req, `/login?next=${encodeURIComponent(pathname + search)}`);
  }

  if (pathname === '/app' || pathname.startsWith('/app/')) {
    if (claims) return NextResponse.next();
    return redirect(req, `/signup?next=${encodeURIComponent(pathname + search)}`);
  }

  return NextResponse.next();
}

function redirect(req: NextRequest, to: string): NextResponse {
  return NextResponse.redirect(new URL(to, req.nextUrl.origin));
}

// SEO-2 needs every request on a non-canonical host, so the middleware sees
// everything except Next's build assets. Auth redirects still only run for
// /app, /admin, /login and /signup (isAuthRoutedPath), referral capture only
// on pages (isPagePath), and /api only gets the noindex header.
export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
