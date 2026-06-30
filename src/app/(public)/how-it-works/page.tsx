import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: 'How Kindly’s AI Companion for Seniors Works',
  description: 'Set it up, your parent talks by voice, and your family gets a respectful weekly summary. Simple, voice-first, senior-friendly.',
  path: '/how-it-works',
});

export default function Page() {
  return (
    <section className="container-k py-20">
      <p className="eyebrow">AI companion for seniors</p>
      <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">How Kindly works</h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">
        This page is part of the Alpha v0.1 scaffold. Content for &ldquo;How Kindly works&rdquo; is drafted in the
        Cycle&nbsp;1 copy + SEO documents and will be filled in on its feature branch.
      </p>
    </section>
  );
}
