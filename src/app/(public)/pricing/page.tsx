import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: 'Kindly Pricing — AI Companion Plans for Families',
  description: 'Simple monthly plans for your parent’s AI companion, with a founding-family offer. Voice, memory, and weekly summaries.',
  path: '/pricing',
});

export default function Page() {
  return (
    <section className="container-k py-20">
      <p className="eyebrow">senior companion app pricing</p>
      <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">Simple plans for staying close</h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">
        This page is part of the Alpha v0.1 scaffold. Content for &ldquo;Simple plans for staying close&rdquo; is drafted in the
        Cycle&nbsp;1 copy + SEO documents and will be filled in on its feature branch.
      </p>
    </section>
  );
}
