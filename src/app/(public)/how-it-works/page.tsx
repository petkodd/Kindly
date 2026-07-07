import Link from 'next/link';
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { HOW_IT_WORKS } from '@/lib/content';

export const metadata: Metadata = buildMetadata({
  title: 'How Kindly’s AI Companion for Seniors Works',
  description: 'Set it up, your parent talks by voice, and your family gets a respectful weekly summary. Simple, voice-first, senior-friendly.',
  path: '/how-it-works',
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
  const { hero, steps, voice, family, boundaries, cta } = HOW_IT_WORKS;
  return (
    <>
      <section className="container-k py-20">
        <p className="eyebrow">AI companion for seniors</p>
        <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">{hero.h1}</h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">{hero.sub}</p>
      </section>

      <section className="bg-cloud py-20">
        <div className="container-k">
          <ol className="grid gap-8 md:grid-cols-3">
            {steps.map((step) => (
              <li key={step.title} className="rounded-2xl border border-line bg-mist p-8">
                <h2 className="text-xl font-semibold text-ink">{step.title}</h2>
                <p className="mt-3 text-base text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="container-k py-20">
        <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{voice.h2}</h2>
        <p className="mt-5 max-w-2xl text-lg text-muted">{voice.body}</p>
      </section>

      <section className="bg-cloud py-20">
        <div className="container-k grid gap-12 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{family.h2}</h2>
            <p className="mt-5 text-lg text-muted">{family.body}</p>
          </div>
          <ul className="space-y-4">
            {family.bullets.map((b) => (
              <li key={b} className="flex gap-3 text-lg text-ink">
                <Check />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="container-k py-20">
        <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{boundaries.h2}</h2>
        <p className="mt-5 max-w-2xl text-lg text-muted">{boundaries.body}</p>
        <Link
          href="/trust-and-privacy"
          className="mt-6 inline-block text-lg font-semibold text-sageDeep underline underline-offset-4"
        >
          Read our trust &amp; privacy promise →
        </Link>
      </section>

      <section className="bg-sageDeep py-20 text-center text-cloud">
        <div className="container-k">
          <h2 className="font-display text-2xl font-semibold md:text-3xl">{cta.h2}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-cloud/85">{cta.body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href={cta.primary.href}
              className="inline-flex min-h-[3.5rem] items-center justify-center rounded-xl bg-cloud px-8 text-lg font-semibold text-sageDeep hover:bg-mist"
            >
              {cta.primary.label}
            </Link>
            <Link
              href={cta.secondary.href}
              className="inline-flex min-h-[3.5rem] items-center justify-center rounded-xl border-2 border-cloud px-8 text-lg font-semibold text-cloud hover:bg-cloud hover:text-sageDeep"
            >
              {cta.secondary.label}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
