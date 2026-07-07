import * as Sentry from '@sentry/nextjs';

// Edge runtime (middleware, edge routes). No-ops when SENTRY_DSN is unset.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
