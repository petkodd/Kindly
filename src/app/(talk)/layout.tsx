import type { Metadata } from 'next';
import { DemoModeBadge } from '@/components/DemoModeBadge';

// The parent's talk screen is private like every app page: never indexed
// (also covered by the X-Robots-Tag header on /app/*).
export const metadata: Metadata = {
  title: 'Talk with Dearly',
  robots: { index: false, follow: false },
};

/**
 * The parent's own layout. It deliberately has none of the buyer's app
 * chrome: no AppNav (its links lead to buyer-only pages that would 401 for the
 * parent) and no "Private — Alpha" label. Just who they are talking to and an
 * always-visible reminder that it is an AI.
 */
export default function TalkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-mist">
      <header className="border-b border-line bg-cloud">
        <div className="container-k flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4">
          <p className="font-display text-2xl font-semibold text-ink">Dearly</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <DemoModeBadge />
            <span
              data-testid="ai-companion-badge"
              className="inline-flex items-center rounded-full border-2 border-sageDeep bg-cloud px-3 py-1 text-base font-semibold text-sageDeep"
            >
              AI companion
            </span>
          </div>
        </div>
      </header>
      <main className="container-k py-8 sm:py-12">{children}</main>
    </div>
  );
}
