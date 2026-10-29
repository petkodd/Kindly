import type { SmsClient, SendSmsInput, SendSmsResult } from './types';

/**
 * Deterministic stand-in for the SMS provider, used in tests, local dev and
 * DEMO_MODE. Logs the intent only — never the number or the body — mirroring
 * fakeEmailClient.
 */
export const fakeSmsClient: SmsClient = {
  async send(_input: SendSmsInput): Promise<SendSmsResult> {
    console.info('[sms:fake] would send an SMS to a recipient');
    return { id: `fake-sms-${Date.now()}`, simulated: true };
  },
};
