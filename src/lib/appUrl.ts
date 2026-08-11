/**
 * Single place that resolves the application's own public base URL —
 * mirrors src/lib/billing/config.ts and src/lib/foundingBeta.ts's "one
 * place, validated, no silent wrong-value fallback" contract. Used anywhere
 * server-side code needs to build an absolute link back into the app (the
 * Founding Family Beta invite script today; a natural home for the
 * checkout route's success/cancel URLs to migrate to later, unchanged here
 * to keep this hardening pass scoped).
 *
 * Precedence: `APP_BASE_URL` first, then `NEXT_PUBLIC_SITE_URL` (the
 * existing var already used for canonical/OG/sitemap and Stripe redirect
 * URLs) as a fallback so a deploy that only set the older var keeps working.
 */

const LOCAL_DEV_DEFAULT = 'http://localhost:3000';

/** Thrown for a missing-in-production or malformed base URL. Distinct name so callers can tell this apart from a generic Error if they ever need to. */
export class AppUrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppUrlConfigError';
  }
}

function isHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Strip any trailing slash(es) so callers can always safely build `${base}/path` without a doubled or missing slash — `https://x.com/`, `https://x.com`, and `https://x.com//` all normalize to `https://x.com`. */
function normalizeBaseUrl(url: URL): string {
  return url.toString().replace(/\/+$/, '');
}

/**
 * Resolve + validate the app's base URL. Fails closed in a Vercel
 * Production environment (`VERCEL_ENV === 'production'`) when neither env
 * var is set — never silently falls back to localhost or a placeholder
 * there. Preview deploys, local dev, and test runs (no `VERCEL_ENV`, or
 * `VERCEL_ENV` = 'preview'/'development') fall back to
 * `http://localhost:3000` so they work with zero configuration.
 *
 * Throws `AppUrlConfigError` for: unset in production, or a configured
 * value that isn't a well-formed absolute http(s) URL. Trailing slashes are
 * normalized away.
 */
export function getAppBaseUrl(): string {
  const configured = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL;

  if (configured) {
    const url = isHttpUrl(configured);
    if (!url) {
      throw new AppUrlConfigError(
        `APP_BASE_URL (or NEXT_PUBLIC_SITE_URL) is set to "${configured}", which is not a valid absolute http(s) URL.`,
      );
    }
    return normalizeBaseUrl(url);
  }

  if (process.env.VERCEL_ENV === 'production') {
    throw new AppUrlConfigError(
      'APP_BASE_URL is not set. Refusing to silently default to localhost in a production environment — set APP_BASE_URL (see .env.example).',
    );
  }

  return LOCAL_DEV_DEFAULT;
}
