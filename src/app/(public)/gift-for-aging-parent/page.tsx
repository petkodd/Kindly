import type { Metadata } from 'next';
import Image from 'next/image';
import { buildMetadata } from '@/lib/seo';
import { GIFT_FOR_AGING_PARENT } from '@/lib/content';
import { TrackedCtaLink } from '@/components/TrackedCtaLink';

export const metadata: Metadata = buildMetadata({
  title: 'A Meaningful Gift for an Aging Parent | Kindly',
  description: 'Give your elderly parent someone kind to talk to every day. Set up Kindly in minutes, with respectful weekly updates for your family.',
  path: '/gift-for-aging-parent',
});

function Check() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="mt-1 h-6 w-6 flex-none text-sage">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 12.5l4 4 10-10"
      />
    </svg>
  );
}

export default function Page() {
  const { hero, why, occasions, reassurance, whatsIncluded, cta } = GIFT_FOR_AGING_PARENT;
  return (
    <>
      <section className="container-k py-20">
        <div className="grid items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="eyebrow">gift for elderly parent</p>
            <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">{hero.h1}</h1>
            <p className="mt-6 max-w-2xl text-lg text-muted">{hero.sub}</p>
          </div>
          <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-line shadow-sm">
            <Image
              src="/images/gift-embrace-joy.webp"
              alt="Adult son presenting a wrapped gift to two smiling senior women in their living room"
              width={984}
              height={1400}
              sizes="(min-width: 768px) 384px, 100vw"
              priority
              className="w-full object-cover"
            />
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-sage mix-blend-multiply opacity-[0.08]" />
          </div>
        </div>
      </section>

      <section className="bg-cloud py-20">
        <div className="container-k grid items-center gap-12 md:grid-cols-[0.9fr_1.1fr]">
          <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-line shadow-sm md:order-2">
            <Image
              src="/images/gift-handing-side.webp"
              alt="Adult son embracing his joyfully laughing senior mother and family member as they hold a wrapped gift together"
              width={800}
              height={1138}
              sizes="(min-width: 768px) 384px, 100vw"
              loading="lazy"
              className="w-full object-cover"
            />
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-sage mix-blend-multiply opacity-[0.08]" />
          </div>
          <div className="md:order-1">
            <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{why.h2}</h2>
            <p className="mt-5 text-lg text-muted">{why.body}</p>
          </div>
        </div>
      </section>

      <section className="container-k py-20">
        <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{occasions.h2}</h2>
        <ul className="mt-8 grid gap-6 md:grid-cols-2">
          {occasions.bullets.map((b) => (
            <li key={b} className="flex gap-3 rounded-2xl border border-line bg-mist p-6 text-lg text-ink">
              <Check />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-cloud py-20">
        <div className="container-k grid gap-12 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{reassurance.h2}</h2>
            <p className="mt-5 text-lg text-muted">{reassurance.body}</p>
          </div>
          <ul className="space-y-4">
            {reassurance.bullets.map((b) => (
              <li key={b} className="flex gap-3 text-lg text-ink">
                <Check />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="container-k py-20 max-w-2xl">
        <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{whatsIncluded.h2}</h2>
        <p className="mt-5 text-lg text-muted">{whatsIncluded.body}</p>
        <TrackedCtaLink
          href={whatsIncluded.cta.href}
          ctaId="whats_included"
          slug="/gift-for-aging-parent"
          className="mt-6 inline-block text-lg font-semibold text-sageDeep underline underline-offset-4"
        >
          {whatsIncluded.cta.label} →
        </TrackedCtaLink>
      </section>

      <section className="bg-sageDeep py-20 text-center text-cloud">
        <div className="container-k">
          <h2 className="font-display text-2xl font-semibold md:text-3xl">{cta.h2}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-cloud/85">{cta.body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <TrackedCtaLink
              href={cta.primary.href}
              ctaId="final_cta_primary"
              slug="/gift-for-aging-parent"
              className="inline-flex min-h-[3.5rem] items-center justify-center rounded-xl bg-cloud px-8 text-lg font-semibold text-sageDeep hover:bg-mist"
            >
              {cta.primary.label}
            </TrackedCtaLink>
            <TrackedCtaLink
              href={cta.secondary.href}
              ctaId="final_cta_secondary"
              slug="/gift-for-aging-parent"
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
