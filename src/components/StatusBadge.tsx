import type { ReactNode } from 'react';

export type StatusTone = 'positive' | 'neutral' | 'warning';

const TONE: Record<StatusTone, string> = {
  positive: 'bg-sageDeep text-cloud',
  neutral: 'border-2 border-field bg-mist text-ink',
  warning: 'border-2 border-error bg-cloud text-error',
};

/**
 * A pill that names a state ("Sent", "Pending", "Sensitive"). The words carry
 * the meaning; colour is only a second cue (WCAG 1.4.1). text-base so it is
 * readable for older eyes; every tone passes 4.5:1 (see the contrast table).
 */
export function StatusBadge({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-0.5 text-base font-semibold ${TONE[tone]}`}>{children}</span>
  );
}
