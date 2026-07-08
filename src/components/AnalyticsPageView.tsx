'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { track } from '@/lib/analyticsClient';

/**
 * Fires `page_viewed` on mount and whenever the pathname changes. Reads
 * referrer/utm straight off `window`/`document` (not the `useSearchParams`
 * hook) so pages stay statically rendered.
 */
export function AnalyticsPageView() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    const utm = typeof window !== 'undefined' ? window.location.search.slice(1) || undefined : undefined;
    track('page_viewed', {
      slug: pathname,
      referrer: typeof document !== 'undefined' ? document.referrer : undefined,
      utm,
    });
  }, [pathname]);

  return null;
}
