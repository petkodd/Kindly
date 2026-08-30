'use client';

import { useState } from 'react';
import { BillingIntervalToggle } from './BillingIntervalToggle';
import { FamilyPlanCard } from './FamilyPlanCard';
import { computeAnnualSavingsPercent } from '@/lib/pricing';
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
 * View-level container for the pricing card. Owns the Monthly/Annual
 * toggle. Defaults to 'year' — Next.js server-renders a Client Component's
 * initial state, so the server-rendered HTML already shows Annual pricing
 * on first paint (the SEO requirement: default pricing must be in the
 * initial HTML, not injected only after a client interaction).
 *
 * Used to render a second, "Founding Family" intro-price card alongside
 * this one — removed 2026-08-29 after it turned out to advertise a $29
 * first-month discount that was never wired to real billing (see the
 * warning comment above PRICING in src/lib/content.ts).
 */
export function PricingCards({ familyPlan }: { familyPlan: FamilyPlan }) {
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('year');
  const savingsPercent = computeAnnualSavingsPercent(familyPlan.priceMonthlyCents, familyPlan.priceAnnualCents);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <BillingIntervalToggle value={billingInterval} onChange={setBillingInterval} label="Family plan billing" />
        {savingsPercent > 0 && <span className="text-sm font-semibold text-sageDeep">Save up to {savingsPercent}% on the annual plan</span>}
      </div>

      <div className="mx-auto mt-10 max-w-md">
        <FamilyPlanCard plan={familyPlan} billingInterval={billingInterval} />
      </div>
    </div>
  );
}
