import type { EmailClient } from './types';
import { fakeEmailClient } from './fake';
import { EMAIL_KEYS, shouldUseFake } from '../runtimeMode';

export * from './types';
export { fakeEmailClient } from './fake';
// Note: createEmailClient is intentionally NOT re-exported here — it is loaded
// lazily below so importing this module never pulls in a real request path on
// the keyless dev/test path (mirrors ai/index.ts and speech/index.ts).

let cached: EmailClient | undefined;

/**
 * Resolve the email client. Uses the real Resend-backed client when
 * EMAIL_API_KEY and EMAIL_FROM are set. Uses the deterministic fake when
 * DEMO_MODE=true, or when either is missing outside production (local dev,
 * tests). On the production deploy a missing value throws
 * MissingProviderKeyError — see src/lib/runtimeMode.ts. The fake reports
 * `simulated: true`, so deliveries through it are recorded as 'simulated'.
 */
export function getEmailClient(): EmailClient {
  if (cached) return cached;
  if (shouldUseFake(EMAIL_KEYS)) {
    cached = fakeEmailClient;
    return cached;
  }
  const apiKey = process.env.EMAIL_API_KEY as string;
  const from = process.env.EMAIL_FROM as string;
  const { createEmailClient } = require('./providers') as typeof import('./providers');
  cached = createEmailClient({ apiKey, from });
  return cached;
}

/** Test seam: reset the memoized client (e.g. after changing env in a test). */
export function resetEmailClient(): void {
  cached = undefined;
}
