'use client';

import Link from 'next/link';
import type { ComponentProps, MouseEvent } from 'react';
import { track } from '@/lib/analyticsClient';

type Props = ComponentProps<typeof Link> & {
  /** Stable id for the CTA, e.g. 'hero_primary', 'final_cta_secondary'. */
  ctaId: string;
  /** The page the CTA lives on, e.g. '/pricing'. */
  slug: string;
};

/** A next/link that fires `cta_clicked` before navigating. */
export function TrackedCtaLink({ ctaId, slug, onClick, ...linkProps }: Props) {
  return (
    <Link
      {...linkProps}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        track('cta_clicked', { cta_id: ctaId, slug });
        onClick?.(e);
      }}
    />
  );
}
