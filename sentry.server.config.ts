import * as Sentry from '@sentry/nextjs';

// Server-side error tracking (API routes, jobs). No-ops when SENTRY_DSN is
// unset. Never sends request bodies — conversation content, memories, and
// summaries are private and must not leave the app via error reports.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
