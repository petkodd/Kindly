import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: 'A Meaningful Gift for an Aging Parent | Kindly',
  description: 'Give your elderly parent someone kind to talk to every day. Set up Kindly in minutes, with respectful weekly updates for your family.',
  path: '/gift-for-aging-parent',
});

export default function Page() {
  return (
    <section className="container-k py-20">
      <p className="eyebrow">gift for elderly parent</p>
      <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">A gift that keeps your parent company</h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">
        This page is part of the Alpha v0.1 scaffold. Content for &ldquo;A gift that keeps your parent company&rdquo; is drafted in the
        Cycle&nbsp;1 copy + SEO documents and will be filled in on its feature branch.
      </p>
    </section>
  );
}
