import * as Sentry from '@sentry/nextjs';

// Client-side error tracking. No-ops (SDK stays idle) when SENTRY_DSN is unset,
// so local dev and CI need no Sentry account — mirrors the "mocked if unset"
// pattern used by the AI/speech/email clients.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  // Conversations may contain sensitive family/health context — never send
  // request bodies or breadcrumb data from the talk UI to Sentry.
  sendDefaultPii: false,
});
