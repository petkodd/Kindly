import type { Metadata } from 'next';
import { buildMetadata, faqPageJsonLd, pricingJsonLd } from '@/lib/seo';
import { PRICING, getFamilyPlan } from '@/lib/content';
import { formatUsdCents } from '@/lib/pricing';
import { CtaBand } from '@/components/CtaBand';
import { PricingCards } from '@/components/PricingCards';

export const metadata: Metadata = buildMetadata({
  title: 'Dearly Pricing — AI Companion Plans for Families',
  description:
    'Try Dearly free for 7 days, then $29/month or $278.40/year. One plan with voice conversation, memory, and a weekly family summary.',
  path: '/pricing',
});

export default function Page() {
  const { hero, plans, faq, cta } = PRICING;
  const familyPlan = getFamilyPlan();

  // pricingJsonLd maps 1:1 over whatever list it's given — pass an extra
  // synthetic entry for the Family plan's annual price so the structured
  // data documents both intervals, without changing the visual layout (the
  // toggle switches within the one Family card, it doesn't add a second card).
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageJsonLd(faq.items)) }}
      />

      <section className="container-k py-20">
        <p className="eyebrow">Pricing</p>
        <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">{hero.h1}</h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">{hero.sub}</p>
      </section>

      <section className="bg-cloud py-20">
        <div className="container-k">
          <PricingCards familyPlan={familyPlan} />
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

      <CtaBand cta={cta} slug="/pricing" />
    </>
  );
}
