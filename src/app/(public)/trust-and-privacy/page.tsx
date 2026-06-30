import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';

export const metadata: Metadata = buildMetadata({
  title: 'Privacy, Trust & Safety | Kindly for Seniors',
  description: 'Private and safe by design. Consent-based, data-minimized, built to support — never replace — family, caregivers, and doctors.',
  path: '/trust-and-privacy',
});

export default function Page() {
  return (
    <section className="container-k py-20">
      <p className="eyebrow">AI companion privacy seniors</p>
      <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">Private and safe, by design</h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">
        This page is part of the Alpha v0.1 scaffold. Content for &ldquo;Private and safe, by design&rdquo; is drafted in the
        Cycle&nbsp;1 copy + SEO documents and will be filled in on its feature branch.
      </p>
    </section>
  );
}
