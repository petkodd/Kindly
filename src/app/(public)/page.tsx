import Link from 'next/link';
import type { Metadata } from 'next';
import { buildMetadata, organizationJsonLd } from '@/lib/seo';
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
              <Link href={HERO.primaryCta.href} className="btn-primary">
                {HERO.primaryCta.label}
              </Link>
              <Link href={HERO.secondaryCta.href} className="btn-secondary">
                {HERO.secondaryCta.label}
              </Link>
            </div>
            <p className="mt-5 text-base text-muted">{HERO.trustline}</p>
          </div>

          {/* Signature element: a soft "talk" card that shows the parent's view. */}
          <div className="relative">
            <div className="mx-auto max-w-sm rounded-2xl border border-line bg-cloud p-8 shadow-sm">
              <p className="text-base text-muted">Robert’s screen</p>
              <div className="mt-6 flex flex-col items-center gap-6 rounded-xl bg-mist p-8 text-center">
                <span className="font-display text-xl text-ink">Hi Robert 👋</span>
                <button
                  type="button"
                  className="flex h-28 w-28 items-center justify-center rounded-full bg-sage text-cloud shadow-md"
                  aria-label="Talk to Kindly (illustration only)"
                  tabIndex={-1}
                >
                  <svg viewBox="0 0 24 24" className="h-12 w-12">
                    <path
                      fill="currentColor"
                      d="M12 14a3 3 0 003-3V6a3 3 0 00-6 0v5a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z"
                    />
                  </svg>
                </button>
                <span className="text-lg font-semibold text-ink">Talk to Kindly</span>
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
        <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{PROBLEM.h2}</h2>
        <p className="mt-5 max-w-2xl text-lg text-muted">{PROBLEM.body}</p>
      </section>

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
            <Link href="/app/onboarding" className="btn-primary">
              Set up the gift
            </Link>
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
          <ul className="space-y-4">
            {SENIORS.bullets.map((b) => (
              <li key={b} className="flex gap-3 text-lg text-ink">
                <Check />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* TRUST */}
      <section className="bg-cloud py-20">
        <div className="container-k grid gap-12 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{TRUST.h2}</h2>
            <p className="mt-5 text-lg text-muted">{TRUST.body}</p>
            <Link
              href={TRUST.cta.href}
              className="mt-6 inline-block text-lg font-semibold text-sageDeep underline underline-offset-4"
            >
              {TRUST.cta.label} →
            </Link>
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
      </section>

      {/* PRICING TEASER */}
      <section className="container-k py-20 text-center">
        <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{PRICING_TEASER.h2}</h2>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">{PRICING_TEASER.body}</p>
        <div className="mt-8">
          <Link href={PRICING_TEASER.cta.href} className="btn-secondary">
            {PRICING_TEASER.cta.label}
          </Link>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-sageDeep py-20 text-center text-cloud">
        <div className="container-k">
          <h2 className="font-display text-2xl font-semibold md:text-3xl">{FINAL_CTA.h2}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-cloud/85">{FINAL_CTA.body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href={FINAL_CTA.primary.href}
              className="inline-flex min-h-[3.5rem] items-center justify-center rounded-xl bg-cloud px-8 text-lg font-semibold text-sageDeep hover:bg-mist"
            >
              {FINAL_CTA.primary.label}
            </Link>
            <Link
              href={FINAL_CTA.secondary.href}
              className="inline-flex min-h-[3.5rem] items-center justify-center rounded-xl border-2 border-cloud px-8 text-lg font-semibold text-cloud hover:bg-cloud hover:text-sageDeep"
            >
              {FINAL_CTA.secondary.label}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
