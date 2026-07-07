import type { EmailClient } from './types';
import { fakeEmailClient } from './fake';

export * from './types';
export { fakeEmailClient } from './fake';
// Note: createEmailClient is intentionally NOT re-exported here — it is loaded
// lazily below so importing this module never pulls in a real request path on
// the keyless dev/test path (mirrors ai/index.ts and speech/index.ts).

let cached: EmailClient | undefined;

/**
 * Resolve the email client. Uses the real Resend-backed client when
 * EMAIL_API_KEY is set; otherwise falls back to the deterministic fake so
 * local dev and tests run without a key (matches the "mocked in Alpha if
 * unset" behavior documented in .env.example).
 */
export function getEmailClient(): EmailClient {
  if (cached) return cached;
  const apiKey = process.env.EMAIL_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    cached = fakeEmailClient;
    return cached;
  }
  const { createEmailClient } = require('./providers') as typeof import('./providers');
  cached = createEmailClient({ apiKey, from });
  return cached;
}

/** Test seam: reset the memoized client (e.g. after changing env in a test). */
export function resetEmailClient(): void {
  cached = undefined;
}
