import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Metadata } from 'next';
import sitemap from '../src/app/sitemap';
import { siteUrl } from '../src/lib/seo';
import { metadata as rootMetadata } from '../src/app/layout';

/**
 * SEO-11: regression net for every public page. Routes are discovered from the
 * filesystem under src/app/(public), so a new page is checked automatically:
 * a page without metadata, with a too-long or duplicate title, a description
 * out of range, a wrong canonical, or that is neither in the sitemap nor
 * explicitly noindex fails here.
 *
 * Rules (from docs/seo-tasks-2026-11-10.md, SEO-11):
 * - every page: exported `metadata` (or `generateMetadata`), a string title of
 *   at most 60 characters, unique across pages, and explicit robots;
 * - indexable pages: description 110–160 characters, unique; canonical =
 *   siteUrl() + path; listed in the sitemap;
 * - noindex pages (`index: false`): never in the sitemap; a description or
 *   canonical, when present, follows the same rules.
 */

const PUBLIC_DIR = join(__dirname, '..', 'src', 'app', '(public)');

interface PublicRoute {
  path: string;
  file: string;
  metadata: Metadata;
}

/** Every page.tsx under (public), as URL paths ('(group)' segments dropped). */
function discoverPageFiles(dir = PUBLIC_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...discoverPageFiles(full));
    else if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(name)) out.push(full);
  }
  return out.sort();
}

function routePattern(file: string): string {
  const segments = relative(PUBLIC_DIR, file).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  return '/' + segments.join('/');
}

function fillParams(pattern: string, params: Record<string, string | string[]>): string {
  return pattern.replace(/\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}/g, (_, key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v.join('/') : String(v);
  });
}

async function loadRoutes(): Promise<PublicRoute[]> {
  const routes: PublicRoute[] = [];
  for (const file of discoverPageFiles()) {
    const pattern = routePattern(file);
    const mod = (await import(file)) as {
      metadata?: Metadata;
      generateMetadata?: (props: { params: Promise<Record<string, unknown>> }) => Promise<Metadata> | Metadata;
      generateStaticParams?: () => Promise<Array<Record<string, string | string[]>>> | Array<Record<string, string | string[]>>;
    };
    if (pattern.includes('[')) {
      // Dynamic route (e.g. /blog/[slug]): every static param gets checked.
      expect(mod.generateStaticParams, `${pattern} needs generateStaticParams`).toBeTypeOf('function');
      expect(mod.generateMetadata, `${pattern} needs generateMetadata`).toBeTypeOf('function');
      for (const params of await mod.generateStaticParams!()) {
        const metadata = await mod.generateMetadata!({ params: Promise.resolve(params) });
        routes.push({ path: fillParams(pattern, params), file, metadata });
      }
      continue;
    }
    const metadata = mod.metadata ?? (mod.generateMetadata ? await mod.generateMetadata({ params: Promise.resolve({}) }) : undefined);
    routes.push({ path: pattern, file, metadata: metadata as Metadata });
  }
  return routes;
}

const isIndexable = (m: Metadata) => {
  const r = m.robots;
  if (typeof r === 'string') return !/noindex/i.test(r);
  return r?.index !== false;
};
const titleOf = (m: Metadata) => (typeof m.title === 'string' ? m.title : undefined);
const canonicalOf = (m: Metadata) => {
  const c = m.alternates?.canonical;
  if (!c) return undefined;
  return typeof c === 'string' ? c : c instanceof URL ? c.toString() : String((c as { url: string | URL }).url);
};

/** Every SEO-11 rule violation across these routes; [] when all pages pass. */
function seoProblems(routes: PublicRoute[], sitemapPaths: Set<string>, base: string): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const discovered = new Set(routes.map((r) => r.path));
  for (const { path, metadata } of routes) {
    if (!metadata) {
      problems.push(`${path}: no metadata export`);
      continue;
    }
    const indexable = isIndexable(metadata);
    const title = titleOf(metadata);
    if (typeof title !== 'string') problems.push(`${path}: title must be a string`);
    else if (title.length > 60) problems.push(`${path}: title "${title}" is ${title.length} > 60 characters`);
    if (!metadata.robots) problems.push(`${path}: robots must be explicit (use buildMetadata)`);

    const d = metadata.description;
    if (typeof d === 'string') {
      if (d.length < 110 || d.length > 160) problems.push(`${path}: description is ${d.length} characters, not 110–160`);
    } else if (indexable) problems.push(`${path}: description missing`);

    const c = canonicalOf(metadata);
    if (c && c !== `${base}${path}`) problems.push(`${path}: canonical ${c} ≠ ${base}${path}`);
    if (indexable && !c) problems.push(`${path}: canonical missing`);
    if (indexable && metadata.openGraph?.url !== `${base}${path}`) problems.push(`${path}: og:url ≠ canonical`);

    for (const [kind, value] of [['title', title], ['description', d]] as const) {
      if (typeof value !== 'string') continue;
      const key = `${kind}:${value.trim().toLowerCase()}`;
      const first = seen.get(key);
      if (first) problems.push(`${path}: repeats the ${kind} of ${first}: "${value}"`);
      else seen.set(key, path);
    }

    const inSitemap = sitemapPaths.has(path);
    if (inSitemap && !indexable) problems.push(`${path}: in the sitemap but index:false`);
    if (!inSitemap && indexable) problems.push(`${path}: indexable but not in the sitemap (add it, or set index:false)`);
  }
  for (const p of sitemapPaths) if (!discovered.has(p)) problems.push(`sitemap lists ${p}, which is not a page under (public)`);
  return problems;
}

let routes: PublicRoute[] = [];
let sitemapPaths: Set<string>;

beforeAll(async () => {
  routes = await loadRoutes();
  const base = siteUrl();
  sitemapPaths = new Set(
    sitemap().map((e) => {
      expect(e.url.startsWith(base), `sitemap URL ${e.url} is on ${base}`).toBe(true);
      return e.url.slice(base.length) || '/';
    }),
  );
}, 60_000);

describe('SEO-11: public pages (discovered from src/app/(public))', () => {
  it('finds the known public pages', () => {
    expect(existsSync(PUBLIC_DIR)).toBe(true);
    const paths = routes.map((r) => r.path);
    for (const p of ['/', '/gift-for-aging-parent', '/how-it-works', '/pricing', '/trust-and-privacy', '/senior-living', '/blog']) {
      expect(paths).toContain(p);
    }
  });

  it('SEO-5: every page says og:locale en_US (its own Open Graph, or the root layout default it inherits)', () => {
    for (const { path, metadata } of routes) {
      // Next merges `openGraph` shallowly: a page's own block replaces the layout's entirely.
      expect((metadata?.openGraph ?? rootMetadata.openGraph)?.locale, path).toBe('en_US');
    }
  });

  it('every page passes every SEO-11 rule', () => {
    expect(seoProblems(routes, sitemapPaths, siteUrl())).toEqual([]);
  });
});

describe('SEO-11: the rules catch a bad page', () => {
  const base = 'https://www.dearlyhere.com';
  const good = (path: string, extra: Partial<Metadata> = {}): PublicRoute => ({
    path,
    file: 'x',
    metadata: {
      title: `Page ${path} | Dearly`,
      description: `A description of ${path} that is long enough to pass the minimum length rule of one hundred and ten characters.`.padEnd(120, '.'),
      alternates: { canonical: `${base}${path}` },
      openGraph: { url: `${base}${path}` },
      robots: { index: true, follow: true },
      ...extra,
    },
  });
  const run = (rs: PublicRoute[], inSitemap: string[]) => seoProblems(rs, new Set(inSitemap), base);

  it('a clean page passes', () => {
    expect(run([good('/a')], ['/a'])).toEqual([]);
  });
  it('a new page without metadata fails', () => {
    expect(run([{ path: '/new', file: 'x', metadata: undefined as unknown as Metadata }], [])).toEqual(['/new: no metadata export']);
  });
  it('a title over 60 characters fails', () => {
    expect(run([good('/a', { title: 'x'.repeat(61) })], ['/a']).join()).toMatch(/61 > 60/);
  });
  it('a description out of 110–160 fails', () => {
    expect(run([good('/a', { description: 'short' })], ['/a']).join()).toMatch(/description is 5 characters/);
    expect(run([good('/a', { description: 'x'.repeat(161) })], ['/a']).join()).toMatch(/161 characters/);
  });
  it('a wrong canonical fails', () => {
    expect(run([good('/a', { alternates: { canonical: 'https://dearly.example.com/a' } })], ['/a']).join()).toMatch(/canonical/);
  });
  it('duplicate titles or descriptions fail', () => {
    const a = good('/a');
    const b = good('/b', { title: a.metadata.title });
    expect(run([a, b], ['/a', '/b']).join()).toMatch(/repeats the title of \/a/);
  });
  it('indexable but missing from the sitemap fails; noindex in the sitemap fails', () => {
    expect(run([good('/a')], []).join()).toMatch(/not in the sitemap/);
    expect(run([good('/a', { robots: { index: false, follow: true } })], ['/a']).join()).toMatch(/in the sitemap but index:false/);
  });
  it('a sitemap URL without a page fails', () => {
    expect(run([good('/a')], ['/a', '/gone']).join()).toMatch(/sitemap lists \/gone/);
  });
});
