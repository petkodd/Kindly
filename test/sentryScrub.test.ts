import { describe, it, expect } from 'vitest';
import {
  scrubEvent,
  scrubString,
  scrubErrorMessage,
  stripQuery,
  describeError,
  sentryScrubOptions,
} from '@/lib/sentryScrub';

const TOKEN = 'tok_9f8e7d6c5b4a';
const EMAIL = 'ann.parent@example.com';
const PG_DETAIL = `Key (email)=(${EMAIL}) already exists.`;

/** Everything Sentry would send, as one string, so a leak anywhere is caught. */
const dump = (v: unknown) => JSON.stringify(v);

describe('sentryScrub: URL query strings (bearer tokens)', () => {
  it('strips token= from the request URL, query_string and Referer of an error event', () => {
    const event = {
      request: {
        url: `https://dearly.app/app/talk?token=${TOKEN}`,
        query_string: `token=${TOKEN}`,
        headers: { Referer: `https://dearly.app/login/verify?token=${TOKEN}&next=/app` },
        data: { text: 'private conversation' },
        cookies: { session: 'abc' },
      },
    };
    const out = sentryScrubOptions.beforeSend(event)!;
    expect(dump(out)).not.toContain(TOKEN);
    expect(dump(out)).not.toContain('private conversation');
    expect(out.request.url).toBe('https://dearly.app/app/talk');
    expect(out.request.headers.Referer).toBe('https://dearly.app/login/verify');
    expect(out.request).not.toHaveProperty('query_string');
    expect(out.request).not.toHaveProperty('cookies');
  });

  it('strips token= from transaction names, span descriptions/data and breadcrumbs', () => {
    const tx = {
      type: 'transaction',
      transaction: `GET /login/verify?token=${TOKEN}`,
      request: { url: `/login/verify?token=${TOKEN}` },
      contexts: { trace: { data: { 'http.url': `https://dearly.app/login/verify?token=${TOKEN}`, 'url.query': `?token=${TOKEN}` } } },
      spans: [
        { description: `GET https://dearly.app/app/talk?token=${TOKEN}`, data: { 'url.full': `https://dearly.app/app/talk?token=${TOKEN}`, 'http.query': `token=${TOKEN}` } },
      ],
      breadcrumbs: [
        { category: 'navigation', data: { from: `/login/verify?token=${TOKEN}`, to: '/app' } },
        { category: 'fetch', data: { url: `/api/talk/message?token=${TOKEN}`, method: 'POST' } },
      ],
    };
    const out = sentryScrubOptions.beforeSendTransaction(tx)!;
    expect(dump(out)).not.toContain(TOKEN);
    expect(out.transaction).toBe('GET /login/verify');
    expect(out.spans[0].description).toBe('GET https://dearly.app/app/talk');
    expect(out.breadcrumbs[0].data.from).toBe('/login/verify');
    expect(out.breadcrumbs[1].data.url).toBe('/api/talk/message');
  });

  it('filters bare token= params in free text but leaves ordinary questions alone', () => {
    expect(scrubString(`retry with token=${TOKEN} later`)).toBe('retry with token=[Filtered] later');
    expect(scrubString('How are you today? Fine, thanks.')).toBe('How are you today? Fine, thanks.');
    expect(stripQuery('/app/talk?token=x#frag')).toBe('/app/talk');
  });
});

describe('sentryScrub: pg error detail', () => {
  it('drops the `detail` field of a pg error wherever it appears', () => {
    const event = {
      exception: { values: [{ type: 'DatabaseError', value: 'duplicate key value violates unique constraint "users_email_key"' }] },
      extra: { DatabaseError: { code: '23505', constraint: 'users_email_key', detail: PG_DETAIL } },
      contexts: { DatabaseError: { detail: PG_DETAIL, table: 'users' } },
    };
    const out = scrubEvent(event)!;
    expect(dump(out)).not.toContain(EMAIL);
    expect(out.extra.DatabaseError).not.toHaveProperty('detail');
    expect(out.extra.DatabaseError.code).toBe('23505');
    expect(out.contexts.DatabaseError).toEqual({ table: 'users' });
  });

  it('removes pg detail text that was already stringified into a console breadcrumb', () => {
    const event = {
      breadcrumbs: [
        {
          category: 'console',
          message: `Unhandled error error: duplicate key value ... detail: '${PG_DETAIL}'`,
          data: { arguments: ['Unhandled error', { name: 'error', detail: PG_DETAIL }] },
        },
      ],
    };
    const out = scrubEvent(event)!;
    expect(dump(out)).not.toContain(EMAIL);
    expect(out.breadcrumbs[0].message).toContain('Key ([Filtered])');
  });

  it('describeError (used for console logs) never includes detail', () => {
    const err = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
      name: 'error',
      code: '23505',
      constraint: 'users_email_key',
      detail: PG_DETAIL,
    });
    const d = describeError(err);
    expect(dump(d)).not.toContain(EMAIL);
    expect(d).toEqual({
      name: 'error',
      message: 'duplicate key value violates unique constraint "users_email_key"',
      code: '23505',
      constraint: 'users_email_key',
    });
  });
});

describe('sentryScrub: provider response bodies', () => {
  it('cuts "X failed: <status> <body>" back to the status code', () => {
    expect(scrubErrorMessage('Deepgram STT failed: 400 {"err_msg":"bad audio for Ann"}')).toBe('Deepgram STT failed: 400');
    expect(scrubErrorMessage(`Email provider request failed (422): {"to":"${EMAIL}"}`)).toBe('Email provider request failed: 422');
    expect(scrubErrorMessage('400 {"type":"error","error":{"message":"..."}}')).toBe('400');
    expect(scrubErrorMessage('ElevenLabs TTS failed: 503')).toBe('ElevenLabs TTS failed: 503');
  });

  it('drops body-style keys and scrubs exception values in events', () => {
    const event = {
      exception: { values: [{ type: 'SpeechError', value: 'ElevenLabs TTS failed: 500 {"text":"I miss you, Maria"}' }] },
      extra: { response: { status: 500, body: 'I miss you, Maria' }, responseBody: '...' },
    };
    const out = scrubEvent(event)!;
    expect(dump(out)).not.toContain('Maria');
    expect(out.exception.values[0].value).toBe('ElevenLabs TTS failed: 500');
    expect(out.extra.response).toEqual({ status: 500 });
  });
});

describe('sentryScrub: robustness', () => {
  it('redacts stray email addresses', () => {
    expect(scrubString(`invite sent to ${EMAIL}`)).toBe('invite sent to [Filtered]');
  });

  it('handles cyclic events and fails closed (drops the event) instead of throwing', () => {
    const cyclic: Record<string, unknown> = { message: `x?token=${TOKEN}` };
    cyclic.self = cyclic;
    expect(() => scrubEvent(cyclic)).not.toThrow();
    const hostile = {
      get exception() {
        throw new Error('boom');
      },
    };
    expect(scrubEvent(hostile)).toBeNull();
  });
});
