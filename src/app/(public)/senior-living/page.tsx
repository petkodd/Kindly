import type { Metadata } from 'next';
import Image from 'next/image';
import { buildMetadata } from '@/lib/seo';
import { SENIOR_LIVING } from '@/lib/content';
import { CtaBand } from '@/components/CtaBand';
import { TrackedCtaLink } from '@/components/TrackedCtaLink';
import { FacilityDemoForm } from '@/components/FacilityDemoForm';

export const metadata: Metadata = buildMetadata({
  title: 'Senior Living Resident Engagement Software | Dearly',
  description:
    'A warm AI companion for senior living residents, with respectful weekly family updates. Request a demo of a founding pilot for your community.',
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
  const { hero, problem, forResidents, forCommunities, boundaries, demo, cta } = SENIOR_LIVING;
  return (
    <>
      <section className="container-k py-20">
        <div className="grid items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="eyebrow">For senior living communities</p>
            <h1 className="mt-4 font-display text-3xl font-semibold text-ink md:text-4xl">{hero.h1}</h1>
            <p className="mt-6 max-w-2xl text-lg text-muted">{hero.sub}</p>
            <div className="mt-8 flex flex-wrap gap-4">
              <TrackedCtaLink href="#demo" ctaId="hero_demo" slug="/senior-living" className="btn-primary">
                Request a demo
              </TrackedCtaLink>
              <TrackedCtaLink href="/how-it-works" ctaId="hero_secondary" slug="/senior-living" className="btn-secondary">
                See how it works
              </TrackedCtaLink>
            </div>
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

      <section id="demo" aria-labelledby="demo-heading" className="scroll-mt-24 bg-cloud py-20">
        <div className="container-k grid gap-12 md:grid-cols-2">
          <div>
            <h2 id="demo-heading" className="font-display text-2xl font-semibold text-ink md:text-3xl">
              {demo.h2}
            </h2>
            <p className="mt-5 text-lg text-muted">{demo.body}</p>
            <ul className="mt-6 space-y-4">
              {demo.bullets.map((b) => (
                <li key={b} className="flex gap-3 text-lg text-ink">
                  <Check />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-line bg-mist p-6 shadow-sm sm:p-8">
            <FacilityDemoForm />
          </div>
        </div>
      </section>

      <CtaBand cta={cta} slug="/senior-living" />
    </>
  );
}
