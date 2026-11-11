import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';

export const metadata: Metadata = {
  title: 'Page not found — Dearly',
  robots: { index: false, follow: false },
};

/** Branded 404 (chat 12): plain words, large type, two clear ways forward. */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="container-k py-20">
        <div className="mx-auto max-w-xl text-center">
          <p className="eyebrow">Page not found</p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-ink">We couldn’t find that page</h1>
          <p className="mt-4 text-lg text-muted">
            The link may be old or mistyped. Nothing is wrong with your account.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link href="/" className="btn-primary">
              Go to the home page
            </Link>
            <Link href="/login" className="btn-secondary">
              Sign in
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
