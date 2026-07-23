/** Shared bullet list for pricing cards — round sageDeep check icon + text. */
export function PlanFeatureList({ bullets }: { bullets: string[] }) {
  return (
    <ul className="mt-6 flex-1 space-y-3">
      {bullets.map((b) => (
        <li key={b} className="flex items-start gap-3 text-base text-ink">
          <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-sageDeep text-cloud">
            <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
              <path
                d="M4 10.5L8 14.5L16 6"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}
