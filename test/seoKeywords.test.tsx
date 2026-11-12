import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

import { render, cleanup } from '@testing-library/react';
import type { Metadata } from 'next';
import type { ComponentType } from 'react';
import HomePage, { metadata as homeMeta } from '../src/app/(public)/page';
import GiftPage, { metadata as giftMeta } from '../src/app/(public)/gift-for-aging-parent/page';
import HowPage, { metadata as howMeta } from '../src/app/(public)/how-it-works/page';
import PricingPage, { metadata as pricingMeta } from '../src/app/(public)/pricing/page';
import TrustPage, { metadata as trustMeta } from '../src/app/(public)/trust-and-privacy/page';
import SeniorPage, { metadata as seniorMeta } from '../src/app/(public)/senior-living/page';
import WaitlistPage, { metadata as waitlistMeta } from '../src/app/(public)/waitlist/page';
import BlogPage, { metadata as blogMeta } from '../src/app/(public)/blog/page';
import { metadata as privacyMeta } from '../src/app/(public)/privacy/page';
import { metadata as termsMeta } from '../src/app/(public)/terms/page';
import { SiteFooter } from '../src/components/SiteFooter';

/**
 * Chat 21c (SEO-3, SEO-10): the keyword map from docs/seo-tasks-2026-11-10.md
 * and the in-content link graph between the indexable marketing pages.
 */

afterEach(() => cleanup());

type Page = { path: string; Page: ComponentType; meta: Metadata; keyword: string; commercial: boolean; titleKeyword?: string };

// Same targets as the audit's KEYWORDS (docs/seo-tasks-2026-11-10.md, SEO-3) plus /trust-and-privacy.
const MAPPED: Page[] = [
  { path: '/', Page: HomePage, meta: homeMeta, keyword: 'AI companion for aging parents', commercial: true },
  { path: '/gift-for-aging-parent', Page: GiftPage, meta: giftMeta, keyword: 'gift for elderly parent', commercial: true },
  { path: '/how-it-works', Page: HowPage, meta: howMeta, keyword: 'AI companion for seniors', commercial: false },
  { path: '/pricing', Page: PricingPage, meta: pricingMeta, keyword: 'senior companion app', commercial: true },
  { path: '/senior-living', Page: SeniorPage, meta: seniorMeta, keyword: 'AI companion for senior living', commercial: false },
  { path: '/trust-and-privacy', Page: TrustPage, meta: trustMeta, keyword: 'AI companion privacy for seniors', commercial: false,
    // The map's title, "AI Companion Privacy & Safety for Seniors", splits the phrase.
    titleKeyword: 'AI companion privacy' },
];

const has = (s: unknown, kw: string) => String(s ?? '').toLowerCase().includes(kw.toLowerCase());
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('SEO-3: keyword map', () => {
  it.each(MAPPED)('$path: title and description carry "$keyword"', ({ meta, keyword, titleKeyword }) => {
    expect(has(meta.title, titleKeyword ?? keyword), String(meta.title)).toBe(true);
    // keyword once in the description
    const d = String(meta.description).toLowerCase();
    expect(d.split(keyword.toLowerCase()).length - 1, d).toBe(1);
    expect(d.length).toBeGreaterThanOrEqual(120);
    expect(d.length).toBeLessThanOrEqual(160);
  });

  it.each(MAPPED.filter((p) => p.path !== '/trust-and-privacy'))('$path: the H1 carries "$keyword"', ({ Page, keyword }) => {
    const { container } = render(<Page />);
    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(has(text(h1s[0]), keyword), text(h1s[0])).toBe(true);
  });

  it.each(MAPPED.filter((p) => p.commercial))('$path: commercial page mentions the 7-day free trial in its description', ({ meta }) => {
    expect(String(meta.description)).toMatch(/7-day free trial|free for 7 days/i);
  });

  it('home H1 = keyword eyebrow + tagline, read as one sentence', () => {
    const { container } = render(<HomePage />);
    expect(text(container.querySelector('h1'))).toBe('AI companion for aging parents — For the moments you can’t be there');
  });

  it('one title pattern: "<Topic> | Dearly" (how-it-works leads with the brand, no suffix)', () => {
    const all: [string, Metadata][] = [
      ...MAPPED.map((p) => [p.path, p.meta] as [string, Metadata]),
      ['/waitlist', waitlistMeta],
      ['/blog', blogMeta],
      ['/privacy', privacyMeta],
      ['/terms', termsMeta],
    ];
    for (const [path, m] of all) {
      const t = String(m.title);
      expect(t, path).not.toMatch(/ — /);
      if (path === '/how-it-works') expect(t).toMatch(/^How Dearly Works: /);
      else expect(t, path).toMatch(/^[^|]+ \| Dearly$/);
    }
  });

  it.each(MAPPED)('$path: natural language — the keyword at most twice per 100 words', ({ Page, keyword }) => {
    const { container } = render(<Page />);
    const body = text(container);
    const words = body.split(' ').length;
    const hits = body.toLowerCase().split(keyword.toLowerCase()).length - 1;
    expect(hits / words * 100, `${hits} hits in ${words} words`).toBeLessThanOrEqual(2);
  });
});

describe('SEO-10: contextual internal links', () => {
  const INDEXABLE = MAPPED;

  /** target path -> set of source pages linking to it from page content (not header/footer). */
  function linkGraph() {
    const graph = new Map<string, Set<string>>();
    const anchors: { from: string; to: string; label: string }[] = [];
    for (const { path, Page } of INDEXABLE) {
      const { container } = render(<Page />);
      for (const a of container.querySelectorAll('a[href]')) {
        if (a.closest('header,nav,footer')) continue;
        const to = (a.getAttribute('href') ?? '').split(/[?#]/)[0] || path;
        if (!to.startsWith('/') || to === path) continue;
        (graph.get(to) ?? graph.set(to, new Set()).get(to)!).add(path);
        anchors.push({ from: path, to, label: text(a) });
      }
      cleanup();
    }
    return { graph, anchors };
  }

  it('every indexable page gets in-content links from at least 2 other pages', () => {
    const { graph } = linkGraph();
    for (const { path } of INDEXABLE) {
      expect([...(graph.get(path) ?? [])].length, `${path} ← ${[...(graph.get(path) ?? [])].join(', ')}`).toBeGreaterThanOrEqual(2);
    }
  });

  it.each([
    ['/', '/gift-for-aging-parent', 'a gift for an aging parent'],
    ['/how-it-works', '/trust-and-privacy', 'how Dearly protects privacy'],
    ['/pricing', '/how-it-works', 'how Dearly works for your parent'],
    ['/senior-living', '/trust-and-privacy', 'how Dearly protects residents’ privacy and safety'],
  ])('%s links to %s with a descriptive anchor', (from, to, label) => {
    const { anchors } = linkGraph();
    expect(anchors).toContainEqual({ from, to, label });
  });

  it('no vague anchors ("click here", "learn more", "read more")', () => {
    const { anchors } = linkGraph();
    for (const a of anchors) expect(a.label, `${a.from} → ${a.to}`).not.toMatch(/^(click here|learn more|read more|here)\b/i);
  });

  it('footer says "Gift for an aging parent"', () => {
    const { container } = render(<SiteFooter />);
    const link = container.querySelector('a[href="/gift-for-aging-parent"]');
    expect(text(link)).toBe('Gift for an aging parent');
  });
});
