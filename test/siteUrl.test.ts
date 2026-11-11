import { describe, it, expect, afterEach, vi } from 'vitest';
import { siteUrlProblem, assertSiteUrlForBuild, SITE_URL_FALLBACK } from '../src/lib/siteUrlGuard.mjs';
import { siteUrl, configuredSiteUrl } from '../src/lib/seo';

/** SEO-1: a production build can never ship the placeholder domain. */

afterEach(() => vi.unstubAllEnvs());

const prod = (siteUrl?: string) => ({ siteUrl, vercelEnv: 'production', nodeEnv: 'production' });
const selfHosted = (siteUrl?: string) => ({ siteUrl, vercelEnv: undefined, nodeEnv: 'production' });

describe('siteUrlProblem: Vercel production build', () => {
  it('missing → refused', () => {
    expect(siteUrlProblem(prod(undefined))).toMatch(/NEXT_PUBLIC_SITE_URL is not set/);
    expect(siteUrlProblem(prod(''))).toMatch(/not set/);
    expect(siteUrlProblem(prod('   '))).toMatch(/not set/);
  });

  it('http:// → refused', () => {
    expect(siteUrlProblem(prod('http://www.dearlyhere.com'))).toMatch(/must start with https/);
  });

  it('the placeholder (any example. host) → refused', () => {
    expect(siteUrlProblem(prod('https://dearly.example.com'))).toMatch(/placeholder/);
    expect(siteUrlProblem(prod('https://example.com'))).toMatch(/placeholder/);
    expect(siteUrlProblem(prod('https://www.example.org/'))).toMatch(/placeholder/);
    expect(siteUrlProblem(prod(SITE_URL_FALLBACK))).toMatch(/placeholder/);
  });

  it('localhost is not a production site URL on Vercel', () => {
    expect(siteUrlProblem(prod('http://localhost:3000'))).toMatch(/https/);
  });

  it('not a URL → refused', () => {
    expect(siteUrlProblem(prod('dearlyhere.com'))).toMatch(/not an absolute URL/);
  });

  it('a real https URL passes (trailing slash fine)', () => {
    expect(siteUrlProblem(prod('https://www.dearlyhere.com'))).toBeNull();
    expect(siteUrlProblem(prod('https://dearlyhere.com/'))).toBeNull();
    // "example" inside a real name is not the placeholder
    expect(siteUrlProblem(prod('https://counterexample.com'))).toBeNull();
  });
});

describe('siteUrlProblem: other builds', () => {
  it('local production build for localhost / 127.0.0.1 passes (audits, `next start`)', () => {
    expect(siteUrlProblem(selfHosted('http://localhost:3000'))).toBeNull();
    expect(siteUrlProblem(selfHosted('http://127.0.0.1:3000'))).toBeNull();
  });

  it('CI build without a URL passes (no VERCEL_ENV)', () => {
    expect(siteUrlProblem(selfHosted(undefined))).toBeNull();
  });

  it('a self-hosted production build pointing at a real host is held to https + no placeholder', () => {
    expect(siteUrlProblem(selfHosted('http://www.dearlyhere.com'))).toMatch(/https/);
    expect(siteUrlProblem(selfHosted('https://dearly.example.com'))).toMatch(/placeholder/);
    expect(siteUrlProblem(selfHosted('https://www.dearlyhere.com'))).toBeNull();
  });

  it('preview / development deployments and the dev server are never blocked', () => {
    expect(siteUrlProblem({ vercelEnv: 'preview', nodeEnv: 'production' })).toBeNull();
    expect(siteUrlProblem({ siteUrl: 'https://dearly.example.com', vercelEnv: 'development', nodeEnv: 'production' })).toBeNull();
    expect(siteUrlProblem({ nodeEnv: 'development' })).toBeNull();
    expect(siteUrlProblem({ nodeEnv: 'test' })).toBeNull();
  });
});

describe('assertSiteUrlForBuild', () => {
  it('throws a clear, actionable message', () => {
    expect(() => assertSiteUrlForBuild(prod(undefined))).toThrow(
      /\[SEO-1\] Refusing to build: NEXT_PUBLIC_SITE_URL is not set\.[\s\S]*Set NEXT_PUBLIC_SITE_URL to the real https:\/\/ domain/,
    );
  });
  it('is silent for a valid URL', () => {
    expect(() => assertSiteUrlForBuild(prod('https://www.dearlyhere.com'))).not.toThrow();
  });
});

describe('siteUrl() / configuredSiteUrl()', () => {
  it('returns the configured URL without trailing slashes', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.dearlyhere.com//');
    expect(siteUrl()).toBe('https://www.dearlyhere.com');
    expect(configuredSiteUrl()).toBe('https://www.dearlyhere.com');
  });
  it('falls back to the placeholder only when unset (dev, tests)', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(configuredSiteUrl()).toBeUndefined();
    expect(siteUrl()).toBe(SITE_URL_FALLBACK);
  });
});

describe('next.config.mjs runs the guard', () => {
  it('importing the config with VERCEL_ENV=production and no URL fails', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.resetModules();
    await expect(import('../next.config.mjs')).rejects.toThrow(/\[SEO-1\] Refusing to build/);
  });
  it('importing the config with a valid production URL works', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.dearlyhere.com');
    vi.resetModules();
    await expect(import('../next.config.mjs')).resolves.toBeTruthy();
  });
});
