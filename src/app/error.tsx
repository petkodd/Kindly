'use client';

import * as Sentry from '@sentry/nextjs';
import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Branded error boundary for every route below the root layout (chat 12).
 * Calm wording, no technical detail on screen (Sentry gets the error), and a
 * large "Try again" button that re-renders the segment.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main id="main" tabIndex={-1} className="min-h-screen bg-mist px-6 py-20">
      <div className="mx-auto max-w-xl text-center" role="alert">
        <p className="font-display text-xl font-semibold text-ink">Dearly</p>
        <h1 className="mt-6 font-display text-3xl font-semibold text-ink">Something went wrong</h1>
        <p className="mt-4 text-lg text-muted">
          This page didn’t load properly. Please try again. If it keeps happening, wait a few minutes and come back.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <button type="button" onClick={reset} className="btn-primary">
            Try again
          </button>
          <Link href="/" className="btn-secondary">
            Go to the home page
          </Link>
        </div>
      </div>
    </main>
  );
}
