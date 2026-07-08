import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { BLOG } from '@/lib/content';
import { WaitlistForm } from '@/components/WaitlistForm';

export const metadata: Metadata = buildMetadata({
  title: 'Kindly Blog — Caring for Aging Parents',
  description: 'Practical, warm guidance for adult children caring for aging parents — connection, technology, and staying close from a distance.',
  path: '/blog',
});

export default function Page() {
  const { hero, comingSoon } = BLOG;
  return (
    <section className="container-k py-20">
      <p className="eyebrow">family updates for aging parents</p>
      <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">{hero.h1}</h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">{hero.sub}</p>

      <div className="mt-14 max-w-2xl rounded-2xl border border-line bg-cloud p-8">
        <h2 className="font-display text-2xl font-semibold text-ink">{comingSoon.h2}</h2>
        <p className="mt-4 text-lg text-muted">{comingSoon.body}</p>
        <div className="mt-8 max-w-md">
          <WaitlistForm sourcePage="/blog" />
        </div>
      </div>
    </section>
  );
}
