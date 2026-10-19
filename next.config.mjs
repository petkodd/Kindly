import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSentryConfig } from '@sentry/nextjs/config';

/** @type {import('next').NextConfig} */

// Content-Security-Policy. Google Fonts are allow-listed (see layout.tsx).
// NOTE: script-src keeps 'unsafe-inline' because Next's hydration scripts are
// inline; a nonce-based script-src via middleware is the follow-up to fully
// close XSS-via-inline-script. Everything else is locked to 'self'.
// connect-src allows Sentry's error-report ingest endpoints (client-side
// captureException calls go directly to Sentry, bypassing our own API).
// `next dev` evaluates its webpack modules with eval(), so ONLY in development
// script-src also gets 'unsafe-eval' — without it the app never hydrates
// locally (no login, no talk screen). Production headers are unchanged.
const isDev = process.env.NODE_ENV === 'development';
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "connect-src 'self' https://*.sentry.io https://*.ingest.sentry.io",
].join('; ');

// Applied to every response: HSTS, anti-sniff/clickjacking, referrer + feature
// policy, and the CSP above.
const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // microphone=(self) — the talk feature records voice input; camera/geolocation stay unused.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), browsing-topics=()' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // src/instrumentation.ts (Sentry server/edge init) is stable in Next 15, so
  // the Next 14 `experimental.instrumentationHook` flag is gone.
  // Pin the tracing root to this project so a nested git worktree (or a stray
  // lockfile in a parent folder) can't make Next pick the wrong workspace root.
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // Private app + admin: never indexed.
        source: '/(app|admin)/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

// withSentryConfig no-ops safely at build time when SENTRY_AUTH_TOKEN/ORG/
// PROJECT are unset (source-map upload is simply skipped) — safe for local
// dev and CI without a Sentry account.
export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  webpack: { treeshake: { removeDebugLogging: true } },
});
