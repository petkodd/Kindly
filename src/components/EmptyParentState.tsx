import Link from 'next/link';

/** Shown when the buyer hasn't set up a parent profile yet — points at onboarding. */
export function EmptyParentState() {
  return (
    <div className="rounded-xl border border-line bg-cloud p-6">
      <p className="text-base text-ink">You haven&rsquo;t set up a parent yet.</p>
      <Link href="/app/onboarding" className="btn-primary mt-4 inline-block">
        Set up the gift
      </Link>
    </div>
  );
}
