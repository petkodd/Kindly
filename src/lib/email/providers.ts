import { EmailError, type EmailClient, type SendEmailInput, type SendEmailResult } from './types';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 300;

// 429 (rate limit) and 5xx are worth a retry; 4xx other than 429 (bad
// request, invalid key, unknown recipient domain, etc.) will just fail the
// same way again, so retrying only wastes a delivery attempt.
function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  }
  // Exponential backoff with jitter: 300ms, 600ms, ... capped, +/-20% jitter
  // so a burst of failures doesn't retry in lockstep.
  const base = BASE_DELAY_MS * 2 ** (attempt - 1);
  const jitter = base * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
}

/**
 * Real email client backed by Resend's HTTP API. Uses plain fetch (no SDK
 * dependency) — mirrors the lazy-load pattern in ai/anthropic.ts and
 * speech/providers.ts, kept out of the keyless path.
 */
export function createEmailClient(opts: {
  apiKey: string;
  from: string;
  /** Test seam: replace the real timer-based delay with something instant/inspectable. */
  sleep?: (ms: number) => Promise<void>;
}): EmailClient {
  const { apiKey, from } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  return {
    async send(input: SendEmailInput): Promise<SendEmailResult> {
      let lastError: EmailError | undefined;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
        if (res.ok) {
          const data = (await res.json()) as { id?: string };
          return { id: data.id ?? 'unknown' };
        }

        const detail = await res.text().catch(() => '');
        lastError = new EmailError(
          `Email provider request failed (${res.status}): ${detail.slice(0, 200)}`,
        );
        if (!isTransient(res.status) || attempt === MAX_ATTEMPTS) throw lastError;
        await sleep(retryDelayMs(attempt, res.headers.get('Retry-After')));
      }

      // Unreachable — the loop above always returns or throws — but keeps TS happy.
      throw lastError ?? new EmailError('Email provider request failed');
    },
  };
}
