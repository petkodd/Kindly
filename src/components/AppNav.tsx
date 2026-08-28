'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
 */
export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Dearly app" className="flex items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
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
  );
}
