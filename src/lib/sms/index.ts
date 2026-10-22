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

/** Test seam: reset the memoized client (e.g. after changing env in a test). */
export function resetSmsClient(): void {
  cached = undefined;
}
