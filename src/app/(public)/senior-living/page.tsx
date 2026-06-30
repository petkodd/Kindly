import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: 'Resident Engagement Software for Senior Living',
  description: 'A warm AI companion and family-engagement platform for senior living and care homes, with respectful reporting.',
  path: '/senior-living',
});

export default function Page() {
  return (
    <section className="container-k py-20">
      <p className="eyebrow">senior living resident engagement software</p>
      <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">Resident engagement, reimagined</h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">
        This page is part of the Alpha v0.1 scaffold. Content for &ldquo;Resident engagement, reimagined&rdquo; is drafted in the
        Cycle&nbsp;1 copy + SEO documents and will be filled in on its feature branch.
      </p>
    </section>
  );
}
