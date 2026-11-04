import type { MetadataRoute } from 'next';
import { SITE, isBlogIndexable } from '@/lib/seo';

/**
 * Public, indexable routes only. /app/*, /admin, /login and /signup are
 * excluded by design.
 *
 * `lastModified` is the date the page's content last really changed — bump it
 * in the same commit that changes the page's copy. It used to be
 * `new Date()`, which told crawlers every page changed on every request.
 */
const SITEMAP_PAGES: ReadonlyArray<{ path: string; lastModified: string; priority: number }> = [
  { path: '', lastModified: '2026-11-02', priority: 1 },
  { path: '/gift-for-aging-parent', lastModified: '2026-11-02', priority: 0.8 },
  { path: '/how-it-works', lastModified: '2026-11-02', priority: 0.8 },
  { path: '/pricing', lastModified: '2026-11-02', priority: 0.8 },
  { path: '/trust-and-privacy', lastModified: '2026-11-02', priority: 0.7 },
  { path: '/senior-living', lastModified: '2026-11-02', priority: 0.7 },
  { path: '/waitlist', lastModified: '2026-11-02', priority: 0.3 },
  { path: '/privacy', lastModified: '2026-10-30', priority: 0.3 },
  { path: '/terms', lastModified: '2026-10-30', priority: 0.3 },
];

/** The blog index joins the sitemap only once it is indexable (3+ articles). */
const BLOG_PAGE = { path: '/blog', lastModified: '2026-11-02', priority: 0.5 };

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = isBlogIndexable() ? [...SITEMAP_PAGES, BLOG_PAGE] : SITEMAP_PAGES;
  return pages.map(({ path, lastModified, priority }) => ({
    url: `${SITE.url}${path}`,
    lastModified,
    changeFrequency: 'monthly',
    priority,
  }));
}
