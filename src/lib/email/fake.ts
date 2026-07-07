import type { EmailClient, SendEmailInput, SendEmailResult } from './types';

/**
 * Deterministic stand-in for the email provider. Used by tests and local dev
 * when EMAIL_API_KEY is unset. Logs the intent (never the full body, to keep
 * test output and local logs free of PII) and returns a fake id — mirrors the
 * fakeAiClient / fakeSpeechClient pattern.
 */
export const fakeEmailClient: EmailClient = {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.info(`[email:fake] would send "${input.subject}" to a recipient`);
    return { id: `fake-${Date.now()}` };
  },
};
