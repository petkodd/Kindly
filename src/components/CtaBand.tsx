import { TrackedCtaLink } from '@/components/TrackedCtaLink';

export interface CtaBandContent {
  h2: string;
  body: string;
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
}

/** The closing call-to-action band shared by the public pages (chat 12). */
export function CtaBand({ cta, slug }: { cta: CtaBandContent; slug: string }) {
  return (
    <section className="bg-sageDeep py-20 text-center text-cloud">
      <div className="container-k">
        <h2 className="font-display text-2xl font-semibold md:text-3xl">{cta.h2}</h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-cloud">{cta.body}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <TrackedCtaLink
            href={cta.primary.href}
            ctaId="final_cta_primary"
            slug={slug}
            className="inline-flex min-h-[3.5rem] items-center justify-center rounded-xl bg-cloud px-8 text-lg font-semibold text-sageDeep hover:bg-mist"
          >
            {cta.primary.label}
          </TrackedCtaLink>
          <TrackedCtaLink
            href={cta.secondary.href}
            ctaId="final_cta_secondary"
            slug={slug}
            className="inline-flex min-h-[3.5rem] items-center justify-center rounded-xl border-2 border-cloud px-8 text-lg font-semibold text-cloud hover:bg-cloud hover:text-sageDeep"
          >
            {cta.secondary.label}
          </TrackedCtaLink>
        </div>
      </div>
    </section>
  );
}
