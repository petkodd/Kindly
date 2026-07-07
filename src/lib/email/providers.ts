import { EmailError, type EmailClient, type SendEmailInput, type SendEmailResult } from './types';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Real email client backed by Resend's HTTP API. Uses plain fetch (no SDK
 * dependency) — mirrors the lazy-load pattern in ai/anthropic.ts and
 * speech/providers.ts, kept out of the keyless path.
 */
export function createEmailClient(opts: { apiKey: string; from: string }): EmailClient {
  const { apiKey, from } = opts;
  return {
    async send(input: SendEmailInput): Promise<SendEmailResult> {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new EmailError(`Email provider request failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      const data = (await res.json()) as { id?: string };
      return { id: data.id ?? 'unknown' };
    },
  };
}
