import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata, isBlogIndexable } from '@/lib/seo';
import { BLOG } from '@/lib/content';
import { WaitlistForm } from '@/components/WaitlistForm';

export const metadata: Metadata = buildMetadata({
  title: 'Dearly Blog — Caring for Aging Parents',
  description: 'Practical, warm guidance for adult children caring for aging parents — connection, technology, and staying close from a distance.',
  path: '/blog',
  // Not indexed until it has real articles (BLOG_INDEX_MIN_ARTICLES); a
  // "coming soon" page is thin content. The sitemap applies the same rule.
  index: isBlogIndexable(),
});

export default function Page() {
  const { hero, comingSoon } = BLOG;
  return (
    <section className="container-k py-20">
      <p className="eyebrow">Blog</p>
      <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">{hero.h1}</h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">{hero.sub}</p>

      <div className="mt-14 max-w-2xl rounded-2xl border border-line bg-cloud p-8">
        <h2 className="font-display text-2xl font-semibold text-ink">{comingSoon.h2}</h2>
        <p className="mt-4 text-lg text-muted">{comingSoon.body}</p>
        <div className="mt-8 max-w-md">
          <WaitlistForm sourcePage="/blog" submitLabel="Email me new posts" doneMessage="Thank you. We’ll email you when the first posts are published." />
        </div>
      </div>

      <p className="mt-10 max-w-2xl text-lg text-muted">
        In the meantime, read{' '}
        <Link href="/how-it-works" className="font-semibold text-sageDeep underline underline-offset-4">
          how Dearly works
        </Link>{' '}
        or{' '}
        <Link href="/trust-and-privacy" className="font-semibold text-sageDeep underline underline-offset-4">
          how we protect your family’s privacy
        </Link>
        .
      </p>
    </section>
  );
}
