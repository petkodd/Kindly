import * as Sentry from '@sentry/nextjs';
import { sentryScrubOptions } from '@/lib/sentryScrub';

// Edge runtime (middleware, edge routes). No-ops when SENTRY_DSN is unset.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  // Strip URL query strings (bearer tokens), pg `detail` and provider response
  // bodies from errors AND transactions. See src/lib/sentryScrub.ts.
  ...sentryScrubOptions,
});
