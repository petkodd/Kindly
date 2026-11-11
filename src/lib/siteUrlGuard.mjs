// SEO-1: the one place that knows the site's public URL rules.
//
// Plain ESM (no TypeScript) so next.config.mjs can import it and fail
// `next build` before a production bundle with the placeholder domain exists.
// Everything in src/ goes through `siteUrl()` in src/lib/seo.ts, which uses
// this file; nothing else reads the env var.

/** Used only outside Vercel production (local dev, CI, tests). Never shipped: the build guard below refuses it. */
export const SITE_URL_FALLBACK = 'https://dearly.example.com';

/** Hosts that mean "a local build" (audits, `next start` on a laptop or CI). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Strip trailing slashes so `${base}${path}` never doubles or drops one. */
export function normalizeSiteUrl(value) {
  return String(value).trim().replace(/\/+$/, '');
}

/**
 * Why this site URL must not be used for this build, or null when it's fine.
 *
 * Strict (every rule) when `VERCEL_ENV=production`: the URL must be set,
 * `https://`, and not a placeholder (`example.`).
 * A production build outside Vercel (`NODE_ENV=production`, no `VERCEL_ENV`)
 * is held to the same https/no-placeholder rules when its URL points at a
 * real host; a build for localhost/127.0.0.1 (audits, CI) and a build with
 * no URL at all (CI) are allowed and use the fallback.
 * Preview and development builds are never blocked.
 *
 * @param {{ siteUrl?: string, vercelEnv?: string, nodeEnv?: string }} env
 * @returns {string | null}
 */
export function siteUrlProblem({ siteUrl, vercelEnv, nodeEnv }) {
  const raw = (siteUrl ?? '').trim();
  const vercelProduction = vercelEnv === 'production';
  if (vercelEnv && !vercelProduction) return null; // preview / development deploys
  if (!vercelProduction && nodeEnv !== 'production') return null; // dev server, tests

  if (!raw) {
    return vercelProduction ? 'NEXT_PUBLIC_SITE_URL is not set.' : null;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return `NEXT_PUBLIC_SITE_URL is "${raw}", which is not an absolute URL.`;
  }
  const host = url.hostname.toLowerCase();
  if (!vercelProduction && LOCAL_HOSTS.has(host)) return null; // local production build

  if (url.protocol !== 'https:') {
    return `NEXT_PUBLIC_SITE_URL is "${raw}", but a production site URL must start with https://.`;
  }
  if (/(^|\.)example\./.test(host)) {
    return `NEXT_PUBLIC_SITE_URL is "${raw}", which is the placeholder domain, not the real one.`;
  }
  return null;
}

/** Throws with a clear, actionable message when `siteUrlProblem` finds one. Called from next.config.mjs. */
export function assertSiteUrlForBuild(env) {
  const problem = siteUrlProblem(env);
  if (problem) {
    throw new Error(
      `\n[SEO-1] Refusing to build: ${problem}\n` +
        'Every canonical URL, Open Graph tag, JSON-LD block, the sitemap, robots.txt and the Stripe return URLs ' +
        'are built from it. Set NEXT_PUBLIC_SITE_URL to the real https:// domain (e.g. https://www.yourdomain.com) ' +
        'in the Vercel production environment and build again.\n',
    );
  }
}
