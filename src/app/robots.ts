import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo';

/**
 * SEO-13: only /api/ is blocked. /app/* and /admin are crawlable on purpose so
 * Google can see their `X-Robots-Tag: noindex, nofollow` (next.config.mjs) and
 * the signed-out redirect (middleware.ts); blocking them would let a linked
 * private URL show up as "Indexed, though blocked by robots.txt".
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
