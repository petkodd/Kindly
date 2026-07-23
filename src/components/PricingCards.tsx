'use client';

import { useState } from 'react';
import { TrackedCtaLink } from './TrackedCtaLink';
import { BillingIntervalToggle } from './BillingIntervalToggle';
import { FamilyPlanCard } from './FamilyPlanCard';
import { PlanFeatureList } from './PlanFeatureList';
import { computeAnnualSavingsPercent } from '@/lib/pricing';
import type { BillingInterval } from '@/lib/billing';

interface FoundingPlan {
  id: string;
  name: string;
  price: string;
  period: string;
  tagline: string;
  bullets: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
}

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
 * View-level container for the two pricing cards. Owns the Monthly/Annual
 * toggle — the toggle only ever changes FamilyPlanCard's price, since
 * Founding Family has no annual price (it's a one-time intro-month offer,
 * see src/lib/content.ts). Defaults to 'year' — Next.js server-renders a
 * Client Component's initial state, so the server-rendered HTML already
 * shows Annual pricing on first paint (the SEO requirement: default pricing
 * must be in the initial HTML, not injected only after a client interaction).
 */
export function PricingCards({ foundingPlan, familyPlan }: { foundingPlan: FoundingPlan; familyPlan: FamilyPlan }) {
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('year');
  const savingsPercent = computeAnnualSavingsPercent(familyPlan.priceMonthlyCents, familyPlan.priceAnnualCents);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <BillingIntervalToggle value={billingInterval} onChange={setBillingInterval} label="Family plan billing" />
        {savingsPercent > 0 && <span className="text-sm font-semibold text-sageDeep">Save up to {savingsPercent}% on the annual plan</span>}
      </div>

      <div className="mt-10 grid gap-8 md:grid-cols-2">
        <div
          className={`relative flex flex-col rounded-2xl border p-8 ${
            foundingPlan.highlighted ? 'border-2 border-sageDeep bg-mist shadow-lg md:-translate-y-2' : 'border-line bg-mist'
          }`}
        >
          {foundingPlan.highlighted && (
            <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-sageDeep px-4 py-1.5 text-sm font-semibold text-cloud shadow-md">
              Best for new families
            </span>
          )}
          <h2 className="text-xl font-semibold text-ink">{foundingPlan.name}</h2>
          <p className="mt-4">
            <span className="font-display text-3xl font-semibold text-ink">{foundingPlan.price}</span>{' '}
            <span className="text-base text-muted">{foundingPlan.period}</span>
          </p>
          <p className="mt-3 text-base text-muted">{foundingPlan.tagline}</p>
          <PlanFeatureList bullets={foundingPlan.bullets} />
          <TrackedCtaLink
            href={foundingPlan.cta.href}
            ctaId={`plan_${foundingPlan.id}`}
            slug="/pricing"
            className={foundingPlan.highlighted ? 'btn-primary mt-8 w-full' : 'btn-secondary mt-8 w-full'}
          >
            {foundingPlan.cta.label}
          </TrackedCtaLink>
        </div>

        <FamilyPlanCard plan={familyPlan} billingInterval={billingInterval} />
      </div>
    </div>
  );
}
