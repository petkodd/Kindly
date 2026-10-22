import { describe, it, expect, afterEach, vi } from 'vitest';
import { getSmsClient, resetSmsClient, fakeSmsClient, SmsError } from '../src/lib/sms';
import { createTwilioSmsClient } from '../src/lib/sms/providers';

const ENV = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'DEMO_MODE'] as const;

afterEach(() => {
  for (const k of ENV) delete process.env[k];
  resetSmsClient();
});

describe('getSmsClient', () => {
  it('uses the fake without Twilio keys', () => {
    expect(getSmsClient()).toBe(fakeSmsClient);
  });

  it('uses the fake in DEMO_MODE even with keys set', () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    process.env.TWILIO_FROM = '+15550000000';
    process.env.DEMO_MODE = 'true';
    expect(getSmsClient()).toBe(fakeSmsClient);
  });

  // The real branch lazy-requires ./providers (not resolvable under vitest, same
  // as the email/AI factories), so the Twilio client itself is tested directly below.
  it('memoizes until resetSmsClient()', () => {
    const first = getSmsClient();
    expect(getSmsClient()).toBe(first);
  });
});

describe('createTwilioSmsClient', () => {
  it('posts To/From/Body with basic auth to the Messages endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 }));
    const client = createTwilioSmsClient({ accountSid: 'AC1', authToken: 'secret', from: '+15550000000', fetchImpl });
    expect(await client.send({ to: '+15551234567', body: 'hello' })).toEqual({ id: 'SM123' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('AC1:secret').toString('base64')}`,
    );
    expect(new URLSearchParams(init.body as string).get('To')).toBe('+15551234567');
    expect(new URLSearchParams(init.body as string).get('From')).toBe('+15550000000');
  });

  it('throws an SmsError that never includes the number or the body', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ code: 21211, message: "The 'To' number +15551234567 is not valid" }), { status: 400 }),
    );
    const client = createTwilioSmsClient({ accountSid: 'AC1', authToken: 'secret', from: '+1555', fetchImpl });
    const err = await client.send({ to: '+15551234567', body: 'private text' }).catch((e) => e);
    expect(err).toBeInstanceOf(SmsError);
    expect(err.message).toBe('Twilio returned HTTP 400 (Twilio code 21211)');
  });
});
