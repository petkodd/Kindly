'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Root-level error boundary — catches errors the framework itself can't
 * recover from (rendering failures above the normal error.tsx boundaries).
 * Required by Sentry for full App Router coverage; see
 * https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#react-render-errors-in-app-router
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ maxWidth: 480, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ marginTop: 12, color: '#666' }}>
            Please refresh the page. If this keeps happening, contact us.
          </p>
        </div>
      </body>
    </html>
  );
}
