import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';
import { signSession, SESSION_COOKIE } from '../src/lib/session';

/**
 * SEO-2: in the Vercel production deployment the site answers on one host.
 * Every other host gets a 308 to the same path + query on the canonical host;
 * /api/* (cron jobs, the Stripe webhook) is never redirected and is noindex.
 */

const CANONICAL = 'https://www.dearlyhere.com';

function req(url: string, init: { host?: string; cookie?: string; method?: string } = {}): NextRequest {
  const u = new URL(url);
  const headers: Record<string, string> = { host: init.host ?? u.host };
  if (init.cookie) headers.cookie = `${SESSION_COOKIE}=${init.cookie}`;
  return new NextRequest(url, { headers, method: init.method ?? 'GET' });
}

beforeEach(() => {
  vi.stubEnv('SESSION_SECRET', 'test-secret-value');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', CANONICAL);
  vi.stubEnv('VERCEL_ENV', 'production');
});
afterEach(() => vi.unstubAllEnvs());

describe('canonical host redirect (SEO-2)', () => {
  it('serves the canonical host as is', async () => {
    const res = await middleware(req('https://www.dearlyhere.com/pricing?x=1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('the *.vercel.app alias → 308 to the same path and query on the canonical host', async () => {
    const res = await middleware(req('https://kindly-abc123.vercel.app/how-it-works?utm_source=x&ref=ABCDEFGHJK'));
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://www.dearlyhere.com/how-it-works?utm_source=x&ref=ABCDEFGHJK');
  });

  it('apex vs www → 308 to the canonical one (both directions)', async () => {
    const apex = await middleware(req('https://dearlyhere.com/'));
    expect(apex.status).toBe(308);
    expect(apex.headers.get('location')).toBe('https://www.dearlyhere.com/');

    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://dearlyhere.com');
    const www = await middleware(req('https://www.dearlyhere.com/gift-for-aging-parent'));
    expect(www.status).toBe(308);
    expect(www.headers.get('location')).toBe('https://dearlyhere.com/gift-for-aging-parent');
  });

  it('host comparison ignores case', async () => {
    const res = await middleware(req('https://www.dearlyhere.com/', { host: 'WWW.DearlyHere.com' }));
    expect(res.status).toBe(200);
  });

  it('redirects private pages, robots.txt, the sitemap and files too, before any auth redirect', async () => {
    for (const p of ['/app/onboarding', '/admin', '/login', '/robots.txt', '/sitemap.xml', '/og/default.png']) {
      const res = await middleware(req(`https://kindly-abc123.vercel.app${p}`));
      expect(res.status, p).toBe(308);
      expect(res.headers.get('location'), p).toBe(`https://www.dearlyhere.com${p}`);
    }
  });

  it('preview and development deployments are never redirected', async () => {
    for (const env of ['preview', 'development']) {
      vi.stubEnv('VERCEL_ENV', env);
      const res = await middleware(req('https://kindly-git-feature-abc.vercel.app/pricing'));
      expect(res.status, env).toBe(200);
      expect(res.headers.get('location'), env).toBeNull();
    }
  });

  it('local `next start` and tests (no VERCEL_ENV) are never redirected', async () => {
    vi.stubEnv('VERCEL_ENV', '');
    const res = await middleware(req('http://localhost:3000/pricing'));
    expect(res.status).toBe(200);
  });

  it('/api/* is not redirected on a non-canonical host; it gets X-Robots-Tag: noindex', async () => {
    const res = await middleware(req('https://kindly-abc123.vercel.app/api/me'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('the Stripe webhook (POST) is not redirected', async () => {
    const res = await middleware(req('https://kindly-abc123.vercel.app/api/billing/webhook', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('cron routes are not redirected', async () => {
    for (const p of ['/api/jobs/generate-weekly-summary', '/api/jobs/purge-hard-deletes', '/api/jobs/end-idle-sessions']) {
      const res = await middleware(req(`https://kindly-abc123.vercel.app${p}`));
      expect(res.status, p).toBe(200);
      expect(res.headers.get('location'), p).toBeNull();
      expect(res.headers.get('x-robots-tag'), p).toBe('noindex');
    }
  });

  it('/api/* on the canonical host is also noindex and passes through', async () => {
    const res = await middleware(req('https://www.dearlyhere.com/api/waitlist', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('existing auth redirects are unchanged on the canonical host', async () => {
    const out = await middleware(req('https://www.dearlyhere.com/app/account'));
    expect(out.status).toBe(307);
    expect(new URL(out.headers.get('location')!).pathname).toBe('/signup');

    const buyer = signSession('11111111-1111-1111-1111-111111111111');
    const signedIn = await middleware(req('https://www.dearlyhere.com/login', { cookie: buyer }));
    expect(new URL(signedIn.headers.get('location')!).pathname).toBe('/app/onboarding');

    const talk = await middleware(req('https://www.dearlyhere.com/app/talk?token=abc'));
    expect(talk.headers.get('location')).toBeNull();
  });

  it('does not trust a spoofed X-Forwarded-Host', async () => {
    const r = new NextRequest('https://kindly-abc123.vercel.app/pricing', {
      headers: { host: 'kindly-abc123.vercel.app', 'x-forwarded-host': 'www.dearlyhere.com' },
    });
    const res = await middleware(r);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://www.dearlyhere.com/pricing');
  });
});
