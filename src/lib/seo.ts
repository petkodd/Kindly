import type { Metadata } from 'next';

export const SITE = {
  name: 'Kindly',
  // Real domain from env (NEXT_PUBLIC_* is inlined at build); falls back to the
  // placeholder in dev. Drives canonical URLs, Open Graph, sitemap, and robots.
  url: process.env.NEXT_PUBLIC_SITE_URL || 'https://kindly.example.com',
  tagline: 'For the moments you can’t be there.',
  description:
    'A warm, voice-first AI companion your aging parent can talk to — with a respectful weekly summary for your family.',
};

type SeoInput = {
  title: string;
  description: string;
  path: string; // e.g. '/pricing'
  index?: boolean; // default true for public pages
  ogType?: 'website' | 'article';
};

/**
 * buildMetadata centralizes the SEO contract from the Cycle 1 metadata table:
 * unique title + description, canonical, Open Graph, Twitter card, robots.
 */
export function buildMetadata({
  title,
  description,
  path,
  index = true,
  ogType = 'website',
}: SeoInput): Metadata {
  const url = `${SITE.url}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: index
      ? { index: true, follow: true }
      : { index: false, follow: false },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE.name,
      type: ogType,
      images: [{ url: `${SITE.url}/og/default.png`, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

/** Organization + WebSite JSON-LD for the home page. */
export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
    slogan: SITE.tagline,
  };
}
