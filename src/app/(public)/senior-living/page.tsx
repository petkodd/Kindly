import type { Metadata } from 'next';
import Image from 'next/image';
import { buildMetadata } from '@/lib/seo';
import { SENIOR_LIVING } from '@/lib/content';
import { TrackedCtaLink } from '@/components/TrackedCtaLink';

export const metadata: Metadata = buildMetadata({
  title: 'Resident Engagement Software for Senior Living',
  description: 'A warm AI companion and family-engagement platform for senior living and care homes, with respectful reporting.',
  path: '/senior-living',
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
  const { hero, problem, forResidents, forCommunities, boundaries, cta } = SENIOR_LIVING;
  return (
    <>
      <section className="container-k py-20">
        <div className="grid items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="eyebrow">senior living resident engagement software</p>
            <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">{hero.h1}</h1>
            <p className="mt-6 max-w-2xl text-lg text-muted">{hero.sub}</p>
          </div>
          <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-line shadow-sm">
            <Image
              src="/images/senior-living-group-tree.webp"
              alt="Group of senior residents gathered together outdoors under a tree"
              width={1000}
              height={961}
              sizes="(min-width: 768px) 384px, 100vw"
              priority
              className="w-full object-cover"
            />
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-sage mix-blend-multiply opacity-[0.08]" />
          </div>
        </div>
      </section>

      <section className="bg-cloud py-20">
        <div className="container-k max-w-2xl">
          <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{problem.h2}</h2>
          <p className="mt-5 text-lg text-muted">{problem.body}</p>
        </div>
      </section>

      <section className="container-k py-20 grid gap-12 md:grid-cols-2">
        <div>
          <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{forResidents.h2}</h2>
          <p className="mt-5 text-lg text-muted">{forResidents.body}</p>
        </div>
        <ul className="space-y-4">
          {forResidents.bullets.map((b) => (
            <li key={b} className="flex gap-3 text-lg text-ink">
              <Check />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-cloud py-20">
        <div className="container-k grid gap-12 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{forCommunities.h2}</h2>
            <p className="mt-5 text-lg text-muted">{forCommunities.body}</p>
          </div>
          <ul className="space-y-4">
            {forCommunities.bullets.map((b) => (
              <li key={b} className="flex gap-3 text-lg text-ink">
                <Check />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="container-k py-20 max-w-2xl">
        <h2 className="font-display text-2xl font-semibold text-ink md:text-3xl">{boundaries.h2}</h2>
        <p className="mt-5 text-lg text-muted">{boundaries.body}</p>
      </section>

      <section className="bg-sageDeep py-20 text-center text-cloud">
        <div className="container-k">
          <h2 className="font-display text-2xl font-semibold md:text-3xl">{cta.h2}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-cloud/85">{cta.body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <TrackedCtaLink
              href={cta.primary.href}
              ctaId="final_cta_primary"
              slug="/senior-living"
              className="inline-flex min-h-[3.5rem] items-center justify-center rounded-xl bg-cloud px-8 text-lg font-semibold text-sageDeep hover:bg-mist"
            >
              {cta.primary.label}
            </TrackedCtaLink>
            <TrackedCtaLink
              href={cta.secondary.href}
              ctaId="final_cta_secondary"
              slug="/senior-living"
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
