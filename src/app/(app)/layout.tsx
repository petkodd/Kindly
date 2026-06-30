import type { Metadata } from 'next';
import Link from 'next/link';

// Every private app page is noindex — reinforced here and via X-Robots-Tag header.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-mist">
      <header className="border-b border-line bg-cloud">
        <div className="container-k flex items-center justify-between py-4">
          <Link href="/" className="font-display text-xl font-semibold text-ink">
            Kindly
          </Link>
          <span className="text-sm text-muted">Private — Alpha v0.1</span>
        </div>
      </header>
      <main className="container-k py-12">{children}</main>
    </div>
  );
}
