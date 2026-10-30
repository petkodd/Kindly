import Link from 'next/link';
import { LEGAL_DRAFT_NOTICE, LEGAL_LAST_UPDATED, type LegalDocument } from '@/lib/legal';

/**
 * Renders a legal document (Privacy Policy / Terms of Use): one H1, the draft
 * banner, a table of contents, then H2 sections with optional H3s.
 */
export function LegalDocumentView({ doc, otherLink }: { doc: LegalDocument; otherLink: { href: string; label: string } }) {
  return (
    <article className="container-k max-w-3xl py-16">
      <p
        role="note"
        className="rounded-xl border-2 border-clay bg-mist px-5 py-4 text-lg font-semibold uppercase tracking-wide text-ink"
      >
        {LEGAL_DRAFT_NOTICE}
      </p>
      <h1 className="mt-8 font-display text-3xl font-semibold text-ink md:text-4xl">{doc.h1}</h1>
      <p className="mt-3 text-base text-muted">
        Last updated <time dateTime={LEGAL_LAST_UPDATED}>{LEGAL_LAST_UPDATED}</time>
      </p>
      <p className="mt-6 text-lg leading-relaxed text-ink">{doc.intro}</p>

      <nav aria-label="On this page" className="mt-8 rounded-xl border border-line bg-cloud px-5 py-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-ink">On this page</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-base">
          {doc.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-sage underline hover:text-ink">
                {s.h2}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {doc.sections.map((s) => (
        <section key={s.id} id={s.id} className="mt-12 scroll-mt-24">
          <h2 className="font-display text-2xl font-semibold text-ink">{s.h2}</h2>
          {s.paragraphs?.map((p) => (
            <p key={p} className="mt-4 text-lg leading-relaxed text-ink">
              {p}
            </p>
          ))}
          {s.bullets && <Bullets items={s.bullets} />}
          {s.subsections?.map((sub) => (
            <div key={sub.h3} className="mt-6">
              <h3 className="text-xl font-semibold text-ink">{sub.h3}</h3>
              {sub.paragraphs?.map((p) => (
                <p key={p} className="mt-3 text-lg leading-relaxed text-ink">
                  {p}
                </p>
              ))}
              {sub.bullets && <Bullets items={sub.bullets} />}
            </div>
          ))}
        </section>
      ))}

      <p className="mt-16 border-t border-line pt-6 text-base text-muted">
        See also our{' '}
        <Link href={otherLink.href} className="text-sage underline hover:text-ink">
          {otherLink.label}
        </Link>{' '}
        and{' '}
        <Link href="/trust-and-privacy" className="text-sage underline hover:text-ink">
          how Dearly keeps families safe
        </Link>
        .
      </p>
    </article>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 list-disc space-y-2 pl-6 text-lg leading-relaxed text-ink">
      {items.map((b) => (
        <li key={b}>{b}</li>
      ))}
    </ul>
  );
}
