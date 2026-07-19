import type { Metadata } from 'next';
import { buildMetadata, pricingJsonLd } from '@/lib/seo';
import { PRICING } from '@/lib/content';
import { formatUsdCents } from '@/lib/pricing';
import { TrackedCtaLink } from '@/components/TrackedCtaLink';
import { FamilyPlanCard } from '@/components/FamilyPlanCard';

export const metadata: Metadata = buildMetadata({
  title: 'Kindly Pricing — AI Companion Plans for Families',
  description: 'Simple monthly plans for your parent’s AI companion, with a founding-family offer. Voice, memory, and weekly summaries.',
  path: '/pricing',
});

export default function Page() {
  const { hero, plans, faq, cta } = PRICING;
  const familyPlanRaw = plans.find((p) => p.id === 'family')!;
  // Narrow: only the 'family' entry carries these fields (founding doesn't
  // have a recurring monthly/annual price), so TS infers them as optional
  // across the shared plans[] shape — assert once here, not per call site.
  const familyPlan = {
    ...familyPlanRaw,
    priceMonthlyCents: familyPlanRaw.priceMonthlyCents!,
    priceAnnualCents: familyPlanRaw.priceAnnualCents!,
  };

  // pricingJsonLd maps 1:1 over whatever list it's given — pass an extra
  // synthetic entry for the Family plan's annual price so the structured
  // data documents both intervals, without changing the visual layout (the
  // toggle switches within the one Family card, it doesn't add a third card).
  const jsonLdPlans = [
    ...plans.map((p) => ({ name: p.name, price: p.price, period: p.period, tagline: p.tagline })),
    {
      name: `${familyPlan.name} (Annual)`,
      price: formatUsdCents(familyPlan.priceAnnualCents),
      period: '/year',
      tagline: familyPlan.tagline,
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(pricingJsonLd(jsonLdPlans)) }}
      />

      <section className="container-k py-20">
        <p className="eyebrow">senior companion app pricing</p>
        <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">{hero.h1}</h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">{hero.sub}</p>
      </section>

      <section className="bg-cloud py-20">
        <div className="container-k grid gap-8 md:grid-cols-2">
          {plans.map((plan) =>
            plan.id === 'family' ? (
              <FamilyPlanCard key={plan.id} plan={familyPlan} />
            ) : (
              <div
                key={plan.id}
                className={`flex flex-col rounded-2xl border p-8 ${
                  plan.highlighted ? 'border-2 border-sageDeep bg-mist' : 'border-line bg-mist'
                }`}
              >
                {plan.highlighted && (
                  <span className="mb-3 inline-block w-fit rounded-full bg-sageDeep px-3 py-1 text-sm font-semibold text-cloud">
                    Best for new families
                  </span>
                )}
                <h2 className="text-xl font-semibold text-ink">{plan.name}</h2>
                <p className="mt-4">
                  <span className="font-display text-3xl font-semibold text-ink">{plan.price}</span>{' '}
                  <span className="text-base text-muted">{plan.period}</span>
                </p>
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
                  className={plan.highlighted ? 'btn-primary mt-8 w-full' : 'btn-secondary mt-8 w-full'}
                >
                  {plan.cta.label}
                </TrackedCtaLink>
              </div>
            ),
          )}
        </div>
      </section>

      <section className="container-k py-20">
        <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{faq.h2}</h2>
        <dl className="mt-10 space-y-8">
          {faq.items.map((item) => (
            <div key={item.q}>
              <dt className="text-lg font-semibold text-ink">{item.q}</dt>
              <dd className="mt-2 max-w-2xl text-lg text-muted">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="bg-sageDeep py-20 text-center text-cloud">
        <div className="container-k">
          <h2 className="font-display text-2xl font-semibold md:text-3xl">{cta.h2}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-cloud/85">{cta.body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <TrackedCtaLink
              href={cta.primary.href}
              ctaId="final_cta_primary"
              slug="/pricing"
              className="inline-flex min-h-[3.5rem] items-center justify-center rounded-xl bg-cloud px-8 text-lg font-semibold text-sageDeep hover:bg-mist"
            >
              {cta.primary.label}
            </TrackedCtaLink>
            <TrackedCtaLink
              href={cta.secondary.href}
              ctaId="final_cta_secondary"
              slug="/pricing"
              className="inline-flex min-h-[3.5rem] items-center justify-center rounded-xl border-2 border-cloud px-8 text-lg font-semibold text-cloud hover:bg-cloud hover:text-sageDeep"
            >
              {cta.secondary.label}
            </TrackedCtaLink>
          </div>
        </div>
      </section>
    </>
  );
}
