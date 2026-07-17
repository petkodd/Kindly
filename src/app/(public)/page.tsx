import type { Metadata } from 'next';
import Image from 'next/image';
import { buildMetadata, organizationJsonLd } from '@/lib/seo';
import { TrackedCtaLink } from '@/components/TrackedCtaLink';
import { Testimonials } from '@/components/Testimonials';
import {
  HERO,
  PROBLEM,
  STEPS,
  SENIORS,
  TRUST,
  PRICING_TEASER,
  FINAL_CTA,
} from '@/lib/content';

export const metadata: Metadata = buildMetadata({
  title: 'Kindly — Warm AI Companion for Aging Parents',
  description:
    'For the moments you can’t be there. Give your aging parent a warm AI companion to talk to, with a gentle weekly summary for family.',
  path: '/',
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

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd()) }}
      />

      {/* HERO — the thesis: warmth and presence, not a tech demo. */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-cloud to-mist"
        />
        <div className="container-k relative grid items-center gap-12 py-20 md:grid-cols-[1.1fr_0.9fr] md:py-28">
          <div>
            <p className="eyebrow">A gift for an aging parent</p>
            <h1 className="mt-4 font-display text-3xl font-semibold leading-tight text-ink md:text-4xl">
              {HERO.h1}
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted">{HERO.sub}</p>
            <div className="mt-8 flex flex-wrap gap-4">
              <TrackedCtaLink href={HERO.primaryCta.href} ctaId="hero_primary" slug="/" className="btn-primary">
                {HERO.primaryCta.label}
              </TrackedCtaLink>
              <TrackedCtaLink href={HERO.secondaryCta.href} ctaId="hero_secondary" slug="/" className="btn-secondary">
                {HERO.secondaryCta.label}
              </TrackedCtaLink>
            </div>
            <p className="mt-5 text-base text-muted">{HERO.trustline}</p>
          </div>

          {/* Photo grounds the hero in real life; the illustrated card overlays it to keep demonstrating the product. */}
          <div className="relative mx-auto w-full max-w-sm pb-8 md:pb-10">
            <div className="relative overflow-hidden rounded-2xl border border-line shadow-sm">
              <Image
                src="/images/senior-phone-picnic.webp"
                alt="Senior man relaxing outdoors at a picnic table, looking at his phone"
                width={1000}
                height={1013}
                sizes="(min-width: 768px) 384px, 100vw"
                priority
                className="w-full object-cover"
              />
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-sage mix-blend-multiply opacity-[0.08]" />
            </div>

            {/* Signature element: a soft "talk" card that shows the parent's view. Sized relative to the photo (not viewport breakpoints) so it never swamps it at in-between widths. */}
            <div className="absolute -bottom-4 -right-4 w-[38%] min-w-[144px] max-w-[190px] rounded-2xl border border-line bg-cloud p-3 shadow-md">
              <p className="text-xs text-muted">Robert’s screen</p>
              <div className="mt-2 flex flex-col items-center gap-2 rounded-xl bg-mist p-3 text-center">
                <span className="font-display text-xs text-ink">Hi Robert 👋</span>
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-sage text-cloud shadow-md"
                  aria-label="Talk to Kindly (illustration only)"
                  tabIndex={-1}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5">
                    <path
                      fill="currentColor"
                      d="M12 14a3 3 0 003-3V6a3 3 0 00-6 0v5a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z"
                    />
                  </svg>
                </button>
                <span className="text-xs font-semibold text-ink">Talk to Kindly</span>
              </div>
            </div>
          </div>
        </div>

        {/* Honest disclosure — required, visible, not buried. */}
        <div className="container-k relative pb-10">
          <p className="rounded-xl border border-line bg-cloud px-5 py-3 text-base text-muted">
            {HERO.disclosure}
          </p>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="container-k py-16">
        <div className="grid items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{PROBLEM.h2}</h2>
            <p className="mt-5 max-w-2xl text-lg text-muted">{PROBLEM.body}</p>
          </div>
          <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-line shadow-sm">
            <Image
              src="/images/senior-bench-sunset.webp"
              alt="Senior woman sitting peacefully on a park bench at sunset"
              width={800}
              height={1055}
              sizes="(min-width: 768px) 384px, 100vw"
              loading="lazy"
              className="w-full object-cover"
            />
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-sage mix-blend-multiply opacity-[0.08]" />
          </div>
        </div>
      </section>

      <Testimonials />

      {/* HOW IT WORKS — a real 3-step sequence, so numbering is earned. */}
      <section className="bg-cloud py-20">
        <div className="container-k">
          <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{STEPS.h2}</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {STEPS.items.map((step, i) => (
              <li key={step.title} className="rounded-2xl border border-line bg-mist p-8">
                <span className="font-display text-2xl text-clay">{i + 1}</span>
                <h3 className="mt-3 text-xl font-semibold text-ink">{step.title}</h3>
                <p className="mt-3 text-base text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-10">
            <TrackedCtaLink href="/app/onboarding" ctaId="steps_primary" slug="/" className="btn-primary">
              Set up the gift
            </TrackedCtaLink>
          </div>
        </div>
      </section>

      {/* BUILT FOR SENIORS */}
      <section className="container-k py-20">
        <div className="grid gap-12 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{SENIORS.h2}</h2>
            <p className="mt-5 text-lg text-muted">{SENIORS.body}</p>
          </div>
          <div className="grid gap-8 sm:grid-cols-[auto_1fr] sm:items-start">
            <div className="relative mx-auto w-full max-w-[220px] overflow-hidden rounded-2xl border border-line shadow-sm sm:mx-0">
              <Image
                src="/images/senior-hands-phone-closeup.webp"
                alt="Close-up of a senior's hands holding a phone"
                width={800}
                height={988}
                sizes="220px"
                loading="lazy"
                className="w-full object-cover"
              />
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-sage mix-blend-multiply opacity-[0.08]" />
            </div>
            <ul className="space-y-4">
              {SENIORS.bullets.map((b) => (
                <li key={b} className="flex gap-3 text-lg text-ink">
                  <Check />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* TRUST */}
      <section className="bg-cloud py-20">
        <div className="container-k grid gap-12 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{TRUST.h2}</h2>
            <p className="mt-5 text-lg text-muted">{TRUST.body}</p>
            <TrackedCtaLink
              href={TRUST.cta.href}
              ctaId="trust_link"
              slug="/"
              className="mt-6 inline-block text-lg font-semibold text-sageDeep underline underline-offset-4"
            >
              {TRUST.cta.label} →
            </TrackedCtaLink>
          </div>
          <div className="grid gap-8 sm:grid-cols-[auto_1fr] sm:items-start">
            <div className="relative mx-auto w-full max-w-[220px] overflow-hidden rounded-2xl border border-line shadow-sm sm:mx-0">
              <Image
                src="/images/couple-walking-park.webp"
                alt="Senior couple walking together in a park"
                width={800}
                height={878}
                sizes="220px"
                loading="lazy"
                className="w-full object-cover"
              />
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-sage mix-blend-multiply opacity-[0.08]" />
            </div>
            <ul className="space-y-4">
              {TRUST.bullets.map((b) => (
                <li key={b} className="flex gap-3 text-lg text-ink">
                  <Check />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* PRICING TEASER */}
      <section className="container-k py-20 text-center">
        <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{PRICING_TEASER.h2}</h2>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">{PRICING_TEASER.body}</p>
        <div className="mt-8">
          <TrackedCtaLink href={PRICING_TEASER.cta.href} ctaId="pricing_teaser" slug="/" className="btn-secondary">
            {PRICING_TEASER.cta.label}
          </TrackedCtaLink>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-sageDeep py-20 text-center text-cloud">
        <div className="container-k">
          <h2 className="font-display text-2xl font-semibold md:text-3xl">{FINAL_CTA.h2}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-cloud/85">{FINAL_CTA.body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <TrackedCtaLink
              href={FINAL_CTA.primary.href}
              ctaId="final_cta_primary"
              slug="/"
              className="inline-flex min-h-[3.5rem] items-center justify-center rounded-xl bg-cloud px-8 text-lg font-semibold text-sageDeep hover:bg-mist"
            >
              {FINAL_CTA.primary.label}
            </TrackedCtaLink>
            <TrackedCtaLink
              href={FINAL_CTA.secondary.href}
              ctaId="final_cta_secondary"
              slug="/"
              className="inline-flex min-h-[3.5rem] items-center justify-center rounded-xl border-2 border-cloud px-8 text-lg font-semibold text-cloud hover:bg-cloud hover:text-sageDeep"
            >
              {FINAL_CTA.secondary.label}
            </TrackedCtaLink>
          </div>
        </div>
      </section>
    </>
  );
}
