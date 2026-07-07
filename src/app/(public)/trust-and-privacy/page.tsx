import Link from 'next/link';
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { TRUST_AND_PRIVACY, FOOTER_LEGAL } from '@/lib/content';

export const metadata: Metadata = buildMetadata({
  title: 'Privacy, Trust & Safety | Kindly for Seniors',
  description: 'Private and safe by design. Consent-based, data-minimized, built to support — never replace — family, caregivers, and doctors.',
  path: '/trust-and-privacy',
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

function Section({
  h2,
  body,
  bullets,
  tone = 'default',
}: {
  h2: string;
  body: string;
  bullets?: string[];
  tone?: 'default' | 'cloud';
}) {
  return (
    <section className={tone === 'cloud' ? 'bg-cloud py-20' : 'py-20'}>
      <div className="container-k grid gap-12 md:grid-cols-2">
        <div>
          <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{h2}</h2>
          <p className="mt-5 text-lg text-muted">{body}</p>
        </div>
        {bullets && (
          <ul className="space-y-4">
            {bullets.map((b) => (
              <li key={b} className="flex gap-3 text-lg text-ink">
                <Check />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default function Page() {
  const { hero, consent, minimization, disclosure, medical, safety, data, cta } = TRUST_AND_PRIVACY;
  return (
    <>
      <div className="container-k py-20">
        <p className="eyebrow">AI companion privacy for seniors</p>
        <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">{hero.h1}</h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">{hero.sub}</p>
      </div>

      <Section h2={consent.h2} body={consent.body} bullets={consent.bullets} tone="cloud" />
      <Section h2={minimization.h2} body={minimization.body} bullets={minimization.bullets} />

      <section className="bg-cloud py-20">
        <div className="container-k max-w-2xl">
          <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{disclosure.h2}</h2>
          <p className="mt-5 text-lg text-muted">{disclosure.body}</p>
        </div>
      </section>

      <section className="py-20">
        <div className="container-k max-w-2xl">
          <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{medical.h2}</h2>
          <p className="mt-5 text-lg text-muted">{medical.body}</p>
        </div>
      </section>

      <section className="bg-cloud py-20">
        <div className="container-k max-w-2xl">
          <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{safety.h2}</h2>
          <p className="mt-5 text-lg text-muted">{safety.body}</p>
        </div>
      </section>

      <section className="py-20">
        <div className="container-k max-w-2xl">
          <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{data.h2}</h2>
          <p className="mt-5 text-lg text-muted">{data.body}</p>
        </div>
      </section>

      <section className="bg-mist py-16">
        <div className="container-k max-w-2xl">
          <p className="text-base text-muted">{FOOTER_LEGAL}</p>
        </div>
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
