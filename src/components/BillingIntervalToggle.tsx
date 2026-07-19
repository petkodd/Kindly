'use client';

import type { BillingInterval } from '@/lib/billing';

interface Props {
  value: BillingInterval;
  onChange: (interval: BillingInterval) => void;
  /** Distinguishes multiple toggles on the same page for assistive tech (e.g. "Family plan billing"). */
  label?: string;
}

const OPTIONS: { value: BillingInterval; label: string }[] = [
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Annual' },
];

/** Shared Monthly/Annual segmented control — used on the pricing page and in checkout/onboarding. */
export function BillingIntervalToggle({ value, onChange, label = 'Billing interval' }: Props) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-line bg-cloud p-1">
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              active ? 'bg-sageDeep text-cloud' : 'text-muted hover:text-ink'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
