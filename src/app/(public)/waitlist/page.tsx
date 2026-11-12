import type { Metadata } from 'next';
import Link from 'next/link';
import { buildMetadata } from '@/lib/seo';
import { WaitlistForm } from '@/components/WaitlistForm';
import { TrackedCtaLink } from '@/components/TrackedCtaLink';
import { signupHref } from '@/lib/nextPath';
import { WAITLIST } from '@/lib/content';

// The slug stays /waitlist so existing links keep working. Chat 13: the
// product is on sale, so this page is for people who aren't ready yet — it
// points to the real signup first and offers email updates second.
export const metadata: Metadata = buildMetadata({
  title: 'Email Updates | Dearly',
  description:
    'Not ready to set up Dearly yet? Leave your email for occasional updates about the AI companion for aging parents. Or start a 7-day free trial today.',
  path: '/waitlist',
  // SEO-4: thin page that competes with the home page's keyword. Reachable
  // and linked, but noindex, follow and out of the sitemap.
  index: false,
  follow: true,
});

export default function WaitlistPage() {
  return (
    <section className="container-k py-20">
      <p className="eyebrow">{WAITLIST.eyebrow}</p>
      <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">{WAITLIST.h1}</h1>
      <p className="mt-6 max-w-2xl text-lg text-muted">{WAITLIST.sub}</p>
      <div className="mt-8 flex flex-wrap gap-4">
        <TrackedCtaLink href={signupHref()} ctaId="waitlist_signup" slug="/waitlist" className="btn-primary">
          Set up the gift
        </TrackedCtaLink>
        <TrackedCtaLink href="/pricing" ctaId="waitlist_pricing" slug="/waitlist" className="btn-secondary">
          See pricing
        </TrackedCtaLink>
      </div>

      <div className="mt-14 max-w-md">
        <h2 className="font-display text-2xl font-semibold text-ink">{WAITLIST.formH2}</h2>
        <p className="mt-3 text-lg text-muted">{WAITLIST.formBody}</p>
        <div className="mt-6">
          <WaitlistForm />
        </div>
      </div>

      <p className="mt-14 max-w-2xl text-lg text-muted">
        Looking for Dearly for a senior living community?{' '}
        <Link href="/senior-living#demo" className="font-semibold text-sageDeep underline underline-offset-4">
          Request a facility demo
        </Link>
        .
      </p>
    </section>
  );
}
