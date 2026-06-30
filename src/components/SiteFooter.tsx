import Link from 'next/link';
import { FOOTER_LEGAL } from '@/lib/content';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '/how-it-works' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Gift for parent', href: '/gift-for-aging-parent' },
    ],
  },
  {
    title: 'Trust',
    links: [
      { label: 'Trust & privacy', href: '/trust-and-privacy' },
      { label: 'Waitlist', href: '/waitlist' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Blog', href: '/blog' },
      { label: 'Senior living', href: '/senior-living' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-cloud">
      <div className="container-k grid gap-10 py-14 md:grid-cols-4">
        <div>
          <p className="font-display text-xl font-semibold text-ink">Kindly</p>
          <p className="mt-2 text-base text-muted">For the moments you can’t be there.</p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="text-sm font-semibold uppercase tracking-wide text-ink">{col.title}</p>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-base text-muted hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="container-k py-6">
          <p className="text-sm leading-relaxed text-muted">{FOOTER_LEGAL}</p>
          <p className="mt-3 text-sm text-muted">© {new Date().getFullYear()} Kindly. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
