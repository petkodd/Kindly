import type { SmsClient } from './types';
import { fakeSmsClient } from './fake';

export * from './types';
export { fakeSmsClient } from './fake';

let cached: SmsClient | undefined;

/**
 * Resolve the SMS client. Uses Twilio when TWILIO_ACCOUNT_SID,
 * TWILIO_AUTH_TOKEN and TWILIO_FROM are all set; otherwise, and always when
 * DEMO_MODE=true, the deterministic fake — so dev, tests and demos never text
 * a real phone. Mirrors getEmailClient().
 */
export function getSmsClient(): SmsClient {
  if (cached) return cached;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (process.env.DEMO_MODE === 'true' || !accountSid || !authToken || !from) {
    cached = fakeSmsClient;
    return cached;
  }
  const { createTwilioSmsClient } = require('./providers') as typeof import('./providers');
  cached = createTwilioSmsClient({ accountSid, authToken, from });
  return cached;
}

/**
 * True on the production deploy (VERCEL_ENV=production, DEMO_MODE off) when
 * the Twilio keys are missing. Twilio is a new paid key (decision D2) that may
 * not exist yet, so this does not throw like the AI/speech/email factories:
 * the alert path records the SMS channel as 'not_configured' and tells the
 * team, instead of reporting a fake send as a delivered alert.
 */
export function isSmsMissingInProduction(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV !== 'production' || env.DEMO_MODE === 'true') return false;
  return !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM;
}

/** Test seam: reset the memoized client (e.g. after changing env in a test). */
export function resetSmsClient(): void {
  cached = undefined;
}
