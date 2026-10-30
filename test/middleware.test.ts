import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware, config } from '../src/middleware';
import { signSession, SESSION_COOKIE } from '../src/lib/session';
import { verifySessionEdge } from '../src/lib/sessionEdge';
import { safeNextPath, signupHref, withNext } from '../src/lib/nextPath';

beforeEach(() => {
  process.env.SESSION_SECRET = 'test-secret-value';
});

function req(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });
}

function location(res: Response): string | null {
  const loc = res.headers.get('location');
  if (!loc) return null;
  const u = new URL(loc);
  return `${u.pathname}${u.search}`;
}

const buyer = () => signSession('11111111-1111-1111-1111-111111111111');
const admin = () => signSession('22222222-2222-2222-2222-222222222222', { isAdmin: true });

describe('middleware (chat 10)', () => {
  it('signed-out /app/* redirects to /signup?next=… (path and query kept)', async () => {
    const res = await middleware(req('/app/onboarding?interval=month'));
    expect(res.status).toBe(307);
    expect(location(res)).toBe(`/signup?next=${encodeURIComponent('/app/onboarding?interval=month')}`);
    expect(location(await middleware(req('/app/family-summary')))).toBe('/signup?next=%2Fapp%2Ffamily-summary');
  });

  it('never redirects the parent talk screen (a parent must never be locked out)', async () => {
    for (const p of ['/app/talk', '/app/talk?token=abc', '/app/talk/anything']) {
      const res = await middleware(req(p));
      expect(location(res)).toBeNull();
    }
  });

  it('signed-out /admin redirects to /login', async () => {
    expect(location(await middleware(req('/admin')))).toBe('/login?next=%2Fadmin');
  });

  it('a signed-in non-admin on /admin goes to the app; an admin passes', async () => {
    expect(location(await middleware(req('/admin', buyer())))).toBe('/app/onboarding');
    expect(location(await middleware(req('/admin', admin())))).toBeNull();
  });

  it('a signed-in buyer passes through /app/*', async () => {
    expect(location(await middleware(req('/app/account', buyer())))).toBeNull();
  });

  it('a signed-in user on /signup or /login goes to the post-login path (next when safe)', async () => {
    expect(location(await middleware(req('/signup', buyer())))).toBe('/app/onboarding');
    expect(location(await middleware(req('/login', buyer())))).toBe('/app/onboarding');
    expect(location(await middleware(req('/login', admin())))).toBe('/admin');
    expect(location(await middleware(req('/signup?next=%2Fapp%2Fonboarding%3Finterval%3Dyear', buyer())))).toBe(
      '/app/onboarding?interval=year',
    );
    // An unsafe next is ignored.
    expect(location(await middleware(req('/login?next=https%3A%2F%2Fevil.example', buyer())))).toBe('/app/onboarding');
  });

  it('signed-out /signup and /login render normally', async () => {
    expect(location(await middleware(req('/signup?next=/app/onboarding')))).toBeNull();
    expect(location(await middleware(req('/login')))).toBeNull();
  });

  it('a forged, tampered or expired cookie counts as signed out', async () => {
    const good = buyer();
    const tampered = `${good.slice(0, -2)}${good.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(location(await middleware(req('/app/account', tampered)))).toBe('/signup?next=%2Fapp%2Faccount');
    expect(location(await middleware(req('/app/account', 'garbage')))).toBe('/signup?next=%2Fapp%2Faccount');
    const expired = signSession('u1', { ttlSeconds: -10 });
    expect(location(await middleware(req('/app/account', expired)))).toBe('/signup?next=%2Fapp%2Faccount');
    process.env.SESSION_SECRET = 'a-different-secret';
    expect(location(await middleware(req('/app/account', good)))).toBe('/signup?next=%2Fapp%2Faccount');
  });

  it('does not touch the password-reset / verify pages, even when signed in', async () => {
    for (const p of ['/login/verify?token=x', '/login/forgot', '/login/reset?token=y']) {
      expect(location(await middleware(req(p, buyer())))).toBeNull();
    }
  });

  it('matches only pages (API routes authenticate themselves)', () => {
    expect(config.matcher).toEqual(['/app', '/app/:path*', '/admin', '/admin/:path*', '/login', '/signup']);
  });
});

describe('verifySessionEdge', () => {
  it('accepts tokens signed by session.ts and returns the same claims', async () => {
    const claims = await verifySessionEdge(admin());
    expect(claims?.uid).toBe('22222222-2222-2222-2222-222222222222');
    expect(claims?.adm).toBe(true);
  });
  it('rejects missing secret, empty and malformed tokens', async () => {
    expect(await verifySessionEdge(buyer(), '')).toBeNull();
    expect(await verifySessionEdge('')).toBeNull();
    expect(await verifySessionEdge('.abc')).toBeNull();
    expect(await verifySessionEdge('abc.!!!')).toBeNull();
  });
});

describe('safeNextPath', () => {
  it('keeps same-site app and admin paths with their query', () => {
    expect(safeNextPath('/app/onboarding')).toBe('/app/onboarding');
    expect(safeNextPath('/app/onboarding?interval=month&invite=x')).toBe('/app/onboarding?interval=month&invite=x');
    expect(safeNextPath('/admin')).toBe('/admin');
  });
  it('rejects other origins, protocol-relative and backslash tricks, control chars and non-strings', () => {
    for (const bad of [
      'https://evil.example/app', '//evil.example/app', '/\\evil.example', '/app\\..', 'javascript:alert(1)',
      '/app/\nfoo', '', '   ', null, undefined, 42, '/' + 'a'.repeat(600),
    ]) {
      expect(safeNextPath(bad as unknown)).toBeNull();
    }
  });
  it('rejects public pages, auth pages and the parent talk screen', () => {
    for (const bad of ['/', '/pricing', '/login', '/signup', '/app/talk', '/app/talk?token=x', '/application']) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });
  it('builds CTA and auth links', () => {
    expect(signupHref()).toBe('/signup?next=%2Fapp%2Fonboarding');
    expect(withNext('/login', '/app/memories')).toBe('/login?next=%2Fapp%2Fmemories');
    expect(withNext('/login', 'https://evil.example')).toBe('/login');
  });
});
