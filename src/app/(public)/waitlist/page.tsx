import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { WaitlistForm } from '@/components/WaitlistForm';

export const metadata: Metadata = buildMetadata({
  title: 'Join the Kindly Waitlist — AI Companion for Aging Parents',
  description:
    'Be first to give your aging parent a warm AI companion. Join the waitlist for early access and a founding-family offer.',
  path: '/waitlist',
});

export default function WaitlistPage() {
  return (
    <section className="container-k py-20">
      <p className="eyebrow">Early access</p>
      <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">
        Join the Kindly waitlist
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">
        Be among the first families to try Kindly. We’ll let you know the moment early access opens,
        along with a founding-family offer.
      </p>
      <div className="mt-10 max-w-md">
        <WaitlistForm />
      </div>
    </section>
  );
}
