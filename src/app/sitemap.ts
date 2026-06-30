import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo';

// Public, indexable routes only. /app/* and /admin are excluded by design.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    '',
    '/gift-for-aging-parent',
    '/how-it-works',
    '/pricing',
    '/trust-and-privacy',
    '/senior-living',
    '/waitlist',
    '/blog',
  ];
  const now = new Date();
  return routes.map((path) => ({
    url: `${SITE.url}${path}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: path === '' ? 1 : 0.7,
  }));
}
