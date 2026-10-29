import type { Metadata } from 'next';
import Link from 'next/link';
import { AppNav } from '@/components/AppNav';
import { DemoModeBadge } from '@/components/DemoModeBadge';

// Every private app page is noindex — reinforced here and via X-Robots-Tag header.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-mist">
      <header className="border-b border-line bg-cloud">
        <div className="container-k flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4">
          <Link href="/" className="font-display text-xl font-semibold text-ink">
            Dearly
          </Link>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Shown on every app page, including the parent's talk screen. */}
            <DemoModeBadge />
            <span className="text-sm text-muted">Private — Alpha v0.1</span>
          </div>
        </div>
        <AppNav />
      </header>
      <main className="container-k py-12">{children}</main>
    </div>
  );
}
