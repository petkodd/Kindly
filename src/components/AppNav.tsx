'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const NAV_ITEMS = [
  { href: '/app/talk', label: 'Talk' },
  { href: '/app/family-summary', label: 'Family Summary' },
  { href: '/app/memories', label: 'Memories' },
  { href: '/app/referrals', label: 'Referrals' },
  { href: '/app/parent-profile', label: 'Parent Profile' },
] as const;

const ACCOUNT_ITEM = { href: '/app/account', label: 'Account' } as const;

function linkCls(active: boolean, variant: 'primary' | 'account'): string {
  const base = 'shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-base font-medium transition-colors';
  if (variant === 'account') {
    return active
      ? `${base} border-2 border-sage bg-sage text-cloud`
      : `${base} border-2 border-line text-muted hover:border-sage hover:text-ink`;
  }
  return active ? `${base} bg-sage text-cloud` : `${base} text-muted hover:bg-mist hover:text-ink`;
}

/**
 * Persistent nav for the six private buyer pages. Account sits outside the
 * scrollable link row so it never scrolls off — settings stays in the same
 * spot on every screen size (per NN/g placement guidance).
 *
 * Hidden on /app/onboarding: that wizard isn't one of the six pages this
 * nav is for, and its final gift-flow step shows a one-time talk link with
 * no other page able to regenerate it — leaving the nav live there let a
 * buyer navigate away before saving it, losing it for good.
 */
export function AppNav() {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);

  // On mobile the primary link row scrolls horizontally and starts at its
  // leftmost position — landing directly on a page whose nav item sits
  // further along (e.g. /app/family-summary) clipped its label mid-word
  // with no indication there was more to scroll to. Bring the active link
  // fully into view whenever the page changes.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  if (pathname?.startsWith('/app/onboarding')) return null;
  return (
    <div className="container-k py-3">
      <nav aria-label="Dearly app" className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                ref={active ? activeRef : undefined}
                aria-current={active ? 'page' : undefined}
                className={linkCls(active, 'primary')}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <Link
          href={ACCOUNT_ITEM.href}
          aria-current={pathname === ACCOUNT_ITEM.href ? 'page' : undefined}
          className={linkCls(pathname === ACCOUNT_ITEM.href, 'account')}
        >
          {ACCOUNT_ITEM.label}
        </Link>
      </nav>
    </div>
  );
}
