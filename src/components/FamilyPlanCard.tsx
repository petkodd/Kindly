'use client';

import { useState } from 'react';
import { TrackedCtaLink } from './TrackedCtaLink';
import { BillingIntervalToggle } from './BillingIntervalToggle';
import { computeAnnualSavingsPercent, formatUsdCents, perMonthEquivalentCents } from '@/lib/pricing';
import type { BillingInterval } from '@/lib/billing';

interface FamilyPlan {
  id: string;
  name: string;
  tagline: string;
  bullets: string[];
  cta: { label: string; href: string };
  priceMonthlyCents: number;
  priceAnnualCents: number;
}

/**
 * The Family plan card with a Monthly/Annual toggle. Defaults to 'year' —
 * since Next.js server-renders a Client Component's initial state, the
 * server-rendered HTML already shows Annual pricing on first paint (the SEO
 * requirement: default pricing must be in the initial HTML, not injected
 * only after a client-side interaction).
 */
export function FamilyPlanCard({ plan }: { plan: FamilyPlan }) {
  const [interval, setInterval] = useState<BillingInterval>('year');
  const savingsPercent = computeAnnualSavingsPercent(plan.priceMonthlyCents, plan.priceAnnualCents);

  return (
    <div className="flex flex-col rounded-2xl border border-line bg-mist p-8">
      <h2 className="text-xl font-semibold text-ink">{plan.name}</h2>
      <div className="mt-4">
        <BillingIntervalToggle value={interval} onChange={setInterval} label={`${plan.name} plan billing`} />
      </div>
      {interval === 'month' ? (
        <p className="mt-4">
          <span className="font-display text-3xl font-semibold text-ink">{formatUsdCents(plan.priceMonthlyCents)}</span>{' '}
          <span className="text-base text-muted">/month</span>
        </p>
      ) : (
        <p className="mt-4">
          <span className="font-display text-3xl font-semibold text-ink">{formatUsdCents(plan.priceAnnualCents)}</span>{' '}
          <span className="text-base text-muted">/year</span>
          <span className="mt-1 flex items-center gap-2 text-sm text-muted">
            {formatUsdCents(perMonthEquivalentCents(plan.priceAnnualCents))}/mo equivalent
            {savingsPercent > 0 && (
              <span className="rounded-full bg-sageDeep/15 px-2 py-0.5 text-xs font-semibold text-sageDeep">
                Save {savingsPercent}%
              </span>
            )}
          </span>
        </p>
      )}
      <p className="mt-3 text-base text-muted">{plan.tagline}</p>
      <ul className="mt-6 flex-1 space-y-3">
        {plan.bullets.map((b) => (
          <li key={b} className="text-base text-ink">
            {b}
          </li>
        ))}
      </ul>
      <TrackedCtaLink
        href={plan.cta.href}
        ctaId={`plan_${plan.id}`}
        slug="/pricing"
        className="btn-secondary mt-8 w-full"
      >
        {plan.cta.label}
      </TrackedCtaLink>
    </div>
  );
}
