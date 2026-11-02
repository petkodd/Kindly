import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { Metadata } from 'next';
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
import sitemap from '../src/app/sitemap';
import { SITE, isBlogIndexable, BLOG_INDEX_MIN_ARTICLES } from '../src/lib/seo';
import * as content from '../src/lib/content';
import { FacilityDemoForm } from '../src/components/FacilityDemoForm';
import { WaitlistForm } from '../src/components/WaitlistForm';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Every string anywhere in the marketing content module. */
function allCopy(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(Object.values(content).filter((v) => typeof v !== 'function'));
  return out;
}

const PAGES = [
  ['/', HomePage, homeMeta],
  ['/gift-for-aging-parent', GiftPage, giftMeta],
  ['/how-it-works', HowPage, howMeta],
  ['/pricing', PricingPage, pricingMeta],
  ['/trust-and-privacy', TrustPage, trustMeta],
  ['/senior-living', SeniorPage, seniorMeta],
  ['/waitlist', WaitlistPage, waitlistMeta],
  ['/blog', BlogPage, blogMeta],
] as const;

const ALL_META: [string, Metadata][] = [
  ...PAGES.map(([p, , m]) => [p, m] as [string, Metadata]),
  ['/privacy', privacyMeta],
  ['/terms', termsMeta],
];

describe('SEO checklist on every public page (chat 13)', () => {
  it('titles and descriptions are unique, and within search-snippet length', () => {
    const titles = ALL_META.map(([, m]) => String(m.title));
    const descs = ALL_META.map(([, m]) => String(m.description));
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descs).size).toBe(descs.length);
    for (const t of titles) expect(t.length, t).toBeLessThanOrEqual(60);
    for (const d of descs) {
      expect(d.length, d).toBeGreaterThanOrEqual(70);
      expect(d.length, d).toBeLessThanOrEqual(160);
    }
  });

  it.each(ALL_META)('%s: canonical and Open Graph point at its own clean URL', (path, m) => {
    const url = `${SITE.url}${path === '/' ? '/' : path}`;
    expect(m.alternates?.canonical).toBe(url);
    expect((m.openGraph as { url?: string }).url).toBe(url);
    expect(m.openGraph?.title).toBe(m.title);
    expect(m.openGraph?.description).toBe(m.description);
    expect(path).toMatch(/^\/[a-z-]*$/);
  });

  it.each(PAGES)('%s: exactly one H1, H2s below it, and links to other pages', (_path, Page) => {
    const { container } = render(<Page />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelectorAll('h2').length).toBeGreaterThanOrEqual(1);
    // Headings never skip a level (h1 → h3 without an h2).
    const levels = [...container.querySelectorAll('h1,h2,h3,h4')].map((h) => Number(h.tagName[1]));
    levels.reduce((prev, cur) => {
      expect(cur - prev).toBeLessThanOrEqual(1);
      return cur;
    });
    const internal = [...container.querySelectorAll('a[href^="/"], a[href^="#"]')];
    expect(internal.length).toBeGreaterThanOrEqual(1);
  });

  it('eyebrows read as plain labels, not lower-case keyword strings', () => {
    const targets = [
      'ai companion for aging parents', 'gift for elderly parent', 'ai companion for seniors', 'senior companion app',
      'family updates for aging parents', 'senior living resident engagement software', 'senior companion app pricing',
      'ai companion privacy for seniors',
    ];
    for (const [, Page] of PAGES) {
      const { container } = render(<Page />);
      for (const el of container.querySelectorAll('.eyebrow')) {
        const text = el.textContent ?? '';
        expect(text[0], text).toMatch(/[A-Z]/);
        expect(targets).not.toContain(text);
      }
      cleanup();
    }
  });
});

describe('indexability and sitemap (chat 13)', () => {
  it('the blog is noindex and out of the sitemap until it has 3+ articles', () => {
    expect(BLOG_INDEX_MIN_ARTICLES).toBe(3);
    expect(isBlogIndexable([])).toBe(false);
    expect(isBlogIndexable([1, 2])).toBe(false);
    expect(isBlogIndexable([1, 2, 3])).toBe(true);
    expect(blogMeta.robots).toEqual({ index: false, follow: false });
    expect(sitemap().map((e) => e.url)).not.toContain(`${SITE.url}/blog`);
  });

  it('every other public page is indexable and in the sitemap; no private page is', () => {
    const urls = sitemap().map((e) => e.url);
    for (const [path, m] of ALL_META) {
      if (path === '/blog') continue;
      expect(m.robots, path).toEqual({ index: true, follow: true });
      expect(urls, path).toContain(`${SITE.url}${path === '/' ? '' : path}`);
    }
    expect(urls.some((u) => /\/(app|admin|login|signup)\b/.test(u))).toBe(false);
  });

  it('lastModified is a fixed, real date per page — not the time of the request', async () => {
    const first = sitemap();
    await new Promise((r) => setTimeout(r, 5));
    const second = sitemap();
    expect(second).toEqual(first);
    for (const e of first) {
      expect(String(e.lastModified)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(String(e.lastModified)).getTime()).not.toBeNaN();
    }
  });
});

describe('structured data (chat 13)', () => {
  const ldOf = (container: HTMLElement) =>
    [...container.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.innerHTML));

  it('home page carries Organization + WebSite JSON-LD', () => {
    const { container } = render(<HomePage />);
    const [ld] = ldOf(container);
    const types = ld['@graph'].map((n: { '@type': string }) => n['@type']);
    expect(types).toEqual(['Organization', 'WebSite']);
    const site = ld['@graph'][1];
    expect(site).toMatchObject({ name: 'Dearly', url: SITE.url, publisher: { '@id': `${SITE.url}/#organization` } });
    expect(site.potentialAction).toBeUndefined(); // no site search exists
  });

  it('pricing carries FAQPage JSON-LD that matches the rendered FAQ', () => {
    const { container } = render(<PricingPage />);
    const faq = ldOf(container).find((d) => d['@type'] === 'FAQPage');
    expect(faq.mainEntity.map((x: { name: string }) => x.name)).toEqual(content.PRICING.faq.items.map((i) => i.q));
    for (const item of content.PRICING.faq.items) expect(screen.getByText(item.q)).toBeTruthy();
  });
});

describe('pricing per D4 (chat 13)', () => {
  it('shows the 7-day trial on the card, for both intervals', () => {
    render(<PricingPage />);
    expect(screen.getByText('7-day free trial')).toBeTruthy();
    expect(screen.getByText(/Free for 7 days, then \$278\.40 a year/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(screen.getByText(/Free for 7 days, then \$29\.00 a month/)).toBeTruthy();
  });

  it('the advertised trial is the trial checkout actually grants', () => {
    const route = read('src/app/api/billing/checkout/route.ts');
    const days = Number(/const TRIAL_DAYS = (\d+);/.exec(route)?.[1]);
    expect(content.getFamilyPlan().trialDays).toBe(days);
    expect(route).toContain('trial_period_days: TRIAL_DAYS');
  });

  it('the meta description no longer calls it a monthly-only plan, and names both prices', () => {
    expect(String(pricingMeta.description)).not.toMatch(/monthly plan/i);
    expect(String(pricingMeta.description)).toContain('$29/month');
    expect(String(pricingMeta.description)).toContain('$278.40/year');
  });

  it('the FAQ answers the trial question and never mentions unsold products', () => {
    const qa = content.PRICING.faq.items.map((i) => `${i.q} ${i.a}`).join(' ');
    expect(qa).toMatch(/Is there a free trial\?/);
    expect(qa).not.toMatch(/prepaid|gift package|price change/i);
  });
});

describe('every public claim has product backing (chat 13)', () => {
  // Phrases the audit found untrue of the merged product. Each one is listed
  // with its replacement in the chat 13 PR.
  const RETIRED = [
    /theirs alone/i,
    /always knows what/i,
    /high contrast are on by default/i,
    /seems? (off|low)/i,
    /tone of a conversation seemed low/i,
    /heads-up if something/i,
    /flag to staff/i,
    /really doing/i,
    /prepaid gift/i,
    /up to 3 family/i,
    /many parents/i,
    /founding-family offer/i,
    /how they’re doing/i,
    // Memories proposed in conversation and D2 safety alerts reach family
    // without a separate yes; only the weekly summary waits for consent.
    /before anything is shared/i,
    /only a short summary/i,
  ];

  it.each(RETIRED.map((r) => [r.source, r]))('no copy says %s', (_s, re) => {
    for (const s of allCopy()) expect(s, s).not.toMatch(re);
  });

  it('the trial, the parent’s consent and the 30-day transcript deletion are stated where the product does them', () => {
    const text = allCopy().join(' ');
    expect(text).toMatch(/7-day free trial/);
    expect(text).toMatch(/nothing is sent until they say yes/i);
    expect(text).toMatch(/transcripts are automatically deleted after 30 days/i);
  });

  it('medical words appear only in disclaimers', () => {
    const MEDICAL = /diagnos|\bcure|\btreat|prevent|depression|dementia|alzheimer|anxiety|loneliness/i;
    const DISCLAIMER = /\bnot\b|n’t|\bnever\b|\bno\b/i;
    const hits = allCopy().filter((s) => MEDICAL.test(s));
    for (const s of hits) expect(s, s).toMatch(DISCLAIMER);
  });
});

describe('brand: Dearly everywhere a person can see (D1, chat 13)', () => {
  function files(dir: string): string[] {
    return readdirSync(join(ROOT, dir)).flatMap((f) => {
      const p = join(dir, f);
      return statSync(join(ROOT, p)).isDirectory() ? files(p) : [p];
    });
  }

  it('no user-visible "Kindly" in pages, components, copy, emails or the manifest', () => {
    const scanned = [
      ...files('src/app').filter((f) => /\.(tsx|ts)$/.test(f) && !f.includes('/api/')),
      ...files('src/components'),
      'src/lib/content.ts',
      'src/lib/seo.ts',
      'src/lib/legal.ts',
      'src/lib/email/templates.ts',
      'public/site.webmanifest',
    ];
    for (const f of scanned) expect(read(f), f).not.toMatch(/\bKindly\b/);
  });

  it('the README names the product Dearly and records D1 as decided', () => {
    const readme = read('README.md');
    expect(readme.split('\n')[0]).toMatch(/^# Dearly/);
    expect(readme).not.toMatch(/still an open founder decision/);
  });
});

describe('CTA strategy (chat 13)', () => {
  it('consumer pages send buyers to signup/pricing, never to the waitlist', () => {
    for (const block of [content.FINAL_CTA, content.GIFT_FOR_AGING_PARENT.cta, content.TRUST_AND_PRIVACY.cta, content.HOW_IT_WORKS.cta, content.PRICING.cta]) {
      expect(block.primary.href).not.toBe('/waitlist');
      expect(block.secondary.href).not.toBe('/waitlist');
    }
  });

  it('senior living points to its own demo form, which posts to /api/demo', () => {
    expect(content.SENIOR_LIVING.cta.primary.href).toBe('/senior-living#demo');
    const { container } = render(<SeniorPage />);
    expect(container.querySelector('section#demo form')).toBeTruthy();
    expect(container.querySelector('a[href="/waitlist"]')).toBeNull();
  });

  it('the waitlist page leads with the real signup', () => {
    render(<WaitlistPage />);
    expect(screen.getByRole('link', { name: 'Set up the gift' }).getAttribute('href')).toMatch(/^\/signup/);
  });
});

describe('FacilityDemoForm (chat 13)', () => {
  const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('shows one message per invalid field, marks it invalid, focuses the first, and sends nothing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<FacilityDemoForm />);
    fill('Work email', 'nope');
    fireEvent.click(screen.getByRole('button', { name: 'Request a demo' }));
    expect(await screen.findByText('Please enter your community’s name.')).toBeTruthy();
    const facility = screen.getByLabelText('Community name');
    expect(facility.getAttribute('aria-invalid')).toBe('true');
    expect(facility.getAttribute('aria-describedby')).toContain('demo-facility_name-error');
    expect(document.activeElement).toBe(facility);
    expect(screen.getByLabelText('Work email').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Phone (optional)').getAttribute('aria-invalid')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts every field to /api/demo and confirms', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<FacilityDemoForm />);
    fill('Community name', 'Maple Grove');
    fill('Number of residents', '40');
    fill('Your role', 'administrator');
    fill('Your name', 'Dana');
    fill('Work email', 'dana@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Request a demo' }));
    expect(await screen.findByText(/received your request/)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/demo');
    expect(JSON.parse(String(init.body))).toMatchObject({
      facility_name: 'Maple Grove', residents: '40', role: 'administrator', name: 'Dana', email: 'dana@example.com', source_page: '/senior-living',
    });
  });

  it('shows the server’s field errors on a 400', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid', fields: { email: 'Server says no.' } } }), { status: 400 })));
    render(<FacilityDemoForm />);
    fill('Community name', 'Maple Grove');
    fill('Number of residents', '40');
    fill('Your role', 'administrator');
    fill('Your name', 'Dana');
    fill('Work email', 'dana@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Request a demo' }));
    expect(await screen.findByText('Server says no.')).toBeTruthy();
  });
});

describe('WaitlistForm validation (chat 13)', () => {
  it.each(['a@b', 'no-at-sign.com', 'two words@example.com'])('blocks %s before sending', async (value) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<WaitlistForm />);
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value } });
    fireEvent.submit(screen.getByLabelText('Your email').closest('form') as HTMLFormElement);
    expect((await screen.findByRole('alert')).textContent).toMatch(/valid email/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is a real form with a required email field and the caller’s button label', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 201 })));
    render(<WaitlistForm sourcePage="/blog" submitLabel="Email me new posts" doneMessage="Done!" />);
    const input = screen.getByLabelText('Your email') as HTMLInputElement;
    expect(input.closest('form')).toBeTruthy();
    expect(input.required).toBe(true);
    fireEvent.change(input, { target: { value: 'sam@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me new posts' }));
    await waitFor(() => expect(screen.getByText('Done!')).toBeTruthy());
  });
});
