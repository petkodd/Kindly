import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: 'Kindly Blog — Caring for Aging Parents',
  description: 'Practical, warm guidance for adult children caring for aging parents — connection, technology, and staying close from a distance.',
  path: '/blog',
});

export default function Page() {
  return (
    <section className="container-k py-20">
      <p className="eyebrow">family updates for aging parents</p>
      <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">The Kindly blog</h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">
        This page is part of the Alpha v0.1 scaffold. Content for &ldquo;The Kindly blog&rdquo; is drafted in the
        Cycle&nbsp;1 copy + SEO documents and will be filled in on its feature branch.
      </p>
    </section>
  );
}
