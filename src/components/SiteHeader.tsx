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
      <div className="container-k flex items-center justify-between py-4">
        <Link href="/" className="font-display text-2xl font-semibold text-ink">
          Kindly
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-7 md:flex">
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
        <div className="flex items-center gap-4 sm:gap-5">
          <AuthStatus />
          <TrackedCtaLink
            href="/app/onboarding"
            ctaId="header_primary"
            slug="header"
            className="btn-primary !min-h-[2.75rem] !px-5 !text-base"
          >
            Set up the gift
          </TrackedCtaLink>
        </div>
      </div>
    </header>
  );
}
