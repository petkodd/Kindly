import Link from 'next/link';
import { TrackedCtaLink } from '@/components/TrackedCtaLink';
import { AuthStatus } from '@/components/AuthStatus';

const NAV = [
  { label: 'How it works', href: '/how-it-works' },
  { label: 'Gift', href: '/gift-for-aging-parent' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Trust & privacy', href: '/trust-and-privacy' },
  { label: 'Senior living', href: '/senior-living' },
];

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-cloud/80 backdrop-blur">
      <div className="container-k flex items-center justify-between gap-2 py-4 sm:gap-4">
        <Link href="/" className="font-display text-xl font-semibold text-ink sm:text-2xl">
          Kindly
        </Link>
        {/* Only shown at lg+ — below that, logo + auth controls alone already
            fill the container width; adding the full nav any earlier crowds
            it against the auth controls (see the account-name overlap bug). */}
        <nav aria-label="Main" className="hidden items-center gap-6 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-base text-muted transition-colors hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2 sm:gap-5">
          <AuthStatus />
          <TrackedCtaLink
            href="/app/onboarding"
            ctaId="header_primary"
            slug="header"
            className="btn-primary !min-h-[2.75rem] !px-3 !text-sm sm:!px-5 sm:!text-base"
          >
            Set up the gift
          </TrackedCtaLink>
        </div>
      </div>
    </header>
  );
}
