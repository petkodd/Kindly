import { describe, it, expect, afterEach, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import type { Metadata } from 'next';
// @ts-expect-error Next ships its compiled path-to-regexp (the matcher behind headers() sources) without types.
import { pathToRegexp as untypedPathToRegexp } from 'next/dist/compiled/path-to-regexp';
import robots from '../src/app/robots';
import sitemap from '../src/app/sitemap';
import RootLayout, { metadata as rootMeta } from '../src/app/layout';
import nextConfig from '../next.config.mjs';
import { middleware } from '../src/middleware';
import { NextRequest } from 'next/server';
import { SITE, buildMetadata, LEGAL_PAGES_DRAFT } from '../src/lib/seo';
import { metadata as waitlistMeta } from '../src/app/(public)/waitlist/page';

/** Chat 21b: SEO-5 (language), SEO-13 (robots.txt), SEO-4 (thin/draft pages). */

const pathToRegexp = untypedPathToRegexp as (source: string) => RegExp;
const sitemapPaths = (entries: { url: string }[]) => entries.map((e) => e.url.slice(SITE.url.length) || '/');

describe('SEO-5: language and locale', () => {
  it('<html lang="en-US"> on every page (root layout)', () => {
    const el = RootLayout({ children: null }) as ReactElement<{ lang?: string }>;
    expect(isValidElement(el)).toBe(true);
    expect(el.type).toBe('html');
    expect(el.props.lang).toBe('en-US');
  });

  it('og:locale en_US from buildMetadata and the root layout default', () => {
    expect(buildMetadata({ title: 't', description: 'd', path: '/x' }).openGraph?.locale).toBe('en_US');
    expect(rootMeta.openGraph?.locale).toBe('en_US');
  });
});

describe('SEO-13: robots.txt', () => {
  it('blocks only /api/; /app/ and /admin are crawlable so their noindex is seen', () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    expect(rules).toEqual([{ userAgent: '*', allow: '/', disallow: ['/api/'] }]);
    expect(r.sitemap).toBe(`${SITE.url}/sitemap.xml`);
  });

  it('/app/* and /admin still send X-Robots-Tag: noindex (next.config.mjs, any response incl. redirects)', async () => {
    type Rule = { source: string; headers: { key: string; value: string }[] };
    const rules = (await nextConfig.headers!()) as Rule[];
    const noindexFor = (path: string) =>
      rules.some(
        (r) =>
          pathToRegexp(r.source).test(path) &&
          r.headers.some((h) => h.key.toLowerCase() === 'x-robots-tag' && /\bnoindex\b/.test(h.value)),
      );
    for (const p of ['/admin', '/admin/users', '/app', '/app/onboarding', '/app/memories', '/app/talk']) {
      expect(noindexFor(p), p).toBe(true);
    }
    // Public pages are not caught by that rule.
    for (const p of ['/', '/pricing', '/apple', '/administrator']) expect(noindexFor(p), p).toBe(false);
  });

  it('signed out, /app/* and /admin redirect instead of rendering', async () => {
    process.env.SESSION_SECRET = 'test-secret-value';
    for (const p of ['/admin', '/app/onboarding', '/app/memories']) {
      const res = await middleware(new NextRequest(`http://localhost:3000${p}`));
      expect(res.status, p).toBe(307);
      expect(new URL(res.headers.get('location')!).pathname, p).toMatch(/^\/(login|signup)$/);
    }
  });
});

describe('SEO-4: thin and draft pages', () => {
  it('/waitlist is noindex, follow and not in the sitemap', () => {
    expect(waitlistMeta.robots).toEqual({ index: false, follow: true });
    expect(sitemapPaths(sitemap())).not.toContain('/waitlist');
  });

  it('buildMetadata: follow defaults to index, and can be set on its own', () => {
    const base = { title: 't', description: 'd', path: '/x' };
    expect(buildMetadata(base).robots).toEqual({ index: true, follow: true });
    expect(buildMetadata({ ...base, index: false }).robots).toEqual({ index: false, follow: false });
    expect(buildMetadata({ ...base, index: false, follow: true }).robots).toEqual({ index: false, follow: true });
  });

  describe('LEGAL_PAGES_DRAFT drives /privacy and /terms', () => {
    afterEach(() => {
      vi.doUnmock('../src/lib/seo');
      vi.resetModules();
    });

    async function load(draft: boolean) {
      vi.resetModules();
      vi.doMock('../src/lib/seo', async (orig) => ({ ...(await orig<typeof import('../src/lib/seo')>()), LEGAL_PAGES_DRAFT: draft }));
      const [{ default: sm }, privacy, terms] = await Promise.all([
        import('../src/app/sitemap'),
        import('../src/app/(public)/privacy/page'),
        import('../src/app/(public)/terms/page'),
      ]);
      return { paths: sitemapPaths(sm()), privacy: privacy.metadata as Metadata, terms: terms.metadata as Metadata };
    }

    it('is on (draft) today', () => {
      expect(LEGAL_PAGES_DRAFT).toBe(true);
    });

    it('draft: both noindex, follow and out of the sitemap', async () => {
      const { paths, privacy, terms } = await load(true);
      expect(privacy.robots).toEqual({ index: false, follow: true });
      expect(terms.robots).toEqual({ index: false, follow: true });
      expect(paths).not.toContain('/privacy');
      expect(paths).not.toContain('/terms');
    });

    it('flipped after legal review: both indexable and back in the sitemap', async () => {
      const { paths, privacy, terms } = await load(false);
      expect(privacy.robots).toEqual({ index: true, follow: true });
      expect(terms.robots).toEqual({ index: true, follow: true });
      expect(paths).toContain('/privacy');
      expect(paths).toContain('/terms');
      expect(paths).not.toContain('/waitlist');
    });
  });
});
