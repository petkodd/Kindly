import { TrackedCtaLink } from './TrackedCtaLink';
import { PlanFeatureList } from './PlanFeatureList';
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
 * The Family plan card. Billing interval is controlled by the shared
 * view-level toggle in PricingCards (not owned here) — the interval is only
 * ever applied to this card's price/CTA, never to the Founding Family card.
 */
export function FamilyPlanCard({ plan, billingInterval }: { plan: FamilyPlan; billingInterval: BillingInterval }) {
  const savingsPercent = computeAnnualSavingsPercent(plan.priceMonthlyCents, plan.priceAnnualCents);

  return (
    <div className="flex flex-col rounded-2xl border border-line bg-mist p-8">
      <h2 className="text-xl font-semibold text-ink">{plan.name}</h2>
      {billingInterval === 'month' ? (
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
      <PlanFeatureList bullets={plan.bullets} />
      <TrackedCtaLink
        // Carries the selected interval into onboarding — otherwise a
        // visitor who picks Monthly here lands back on checkout's own
        // (Annual) default with no memory of that choice.
        href={`${plan.cta.href}?interval=${billingInterval}`}
        ctaId={`plan_${plan.id}`}
        slug="/pricing"
        className="btn-secondary mt-8 w-full"
      >
        {plan.cta.label}
      </TrackedCtaLink>
    </div>
  );
}
