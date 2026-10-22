import { SmsError, type SmsClient, type SendSmsInput, type SendSmsResult } from './types';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';
const TIMEOUT_MS = 10_000;

/**
 * Real SMS client backed by Twilio's Messages REST API. Plain fetch, no SDK
 * dependency, loaded lazily (see ./index.ts) so it never runs on the keyless
 * path. Errors carry the HTTP status and Twilio error code only — never the
 * phone number or the message, which Twilio echoes in its error text.
 */
export function createTwilioSmsClient(opts: {
  accountSid: string;
  authToken: string;
  from: string;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}): SmsClient {
  const { accountSid, authToken, from } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  return {
    async send(input: SendSmsInput): Promise<SendSmsResult> {
      const body = new URLSearchParams({ To: input.to, From: from, Body: input.body });
      let res: Response;
      try {
        res = await doFetch(`${TWILIO_API}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
          method: 'POST',
          headers: {
            authorization: `Basic ${auth}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        throw new SmsError(`Twilio request failed: ${(err as Error).name}`);
      }
      if (!res.ok) {
        let code = '';
        try {
          const json = (await res.json()) as { code?: number };
          if (json.code) code = ` (Twilio code ${json.code})`;
        } catch {
          // ignore an unparseable error body
        }
        throw new SmsError(`Twilio returned HTTP ${res.status}${code}`);
      }
      const json = (await res.json()) as { sid?: string };
      return { id: json.sid ?? 'unknown' };
    },
  };
}
