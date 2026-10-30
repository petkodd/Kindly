import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionEdge } from '@/lib/sessionEdge';
import { safeNextPath } from '@/lib/nextPath';

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
 * API routes are not matched here; they authenticate with resolveBuyer.
 */
export async function middleware(req: NextRequest) {
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

export const config = {
  matcher: ['/app', '/app/:path*', '/admin', '/admin/:path*', '/login', '/signup'],
};
