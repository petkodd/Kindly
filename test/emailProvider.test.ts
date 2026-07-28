import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEmailClient } from '../src/lib/email/providers';
import { EmailError } from '../src/lib/email/types';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const INPUT = { to: 'mike@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createEmailClient retry/backoff', () => {
  it('succeeds on the first try with no retries', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { id: 'em_1' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createEmailClient({ apiKey: 'k', from: 'a@b.com', sleep: vi.fn().mockResolvedValue(undefined) });

    const result = await client.send(INPUT);

    expect(result).toEqual({ id: 'em_1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 rate limit and succeeds on the second attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { message: 'rate limited' }, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'em_2' }));
    vi.stubGlobal('fetch', fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createEmailClient({ apiKey: 'k', from: 'a@b.com', sleep });

    const result = await client.send(INPUT);

    expect(result).toEqual({ id: 'em_2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Retry-After: 1 (second) is honored verbatim as the backoff delay.
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('retries a transient 503 with exponential backoff, then gives up after the max attempts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(503, { message: 'upstream down' }));
    vi.stubGlobal('fetch', fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createEmailClient({ apiKey: 'k', from: 'a@b.com', sleep });

    await expect(client.send(INPUT)).rejects.toBeInstanceOf(EmailError);

    expect(fetchMock).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS, no more
    expect(sleep).toHaveBeenCalledTimes(2); // between attempts 1->2 and 2->3, not after the last
    const [firstDelay, secondDelay] = sleep.mock.calls.map((c) => c[0] as number);
    expect(secondDelay).toBeGreaterThan(firstDelay); // exponential, not flat
  });

  it('does not retry a permanent 400 (bad request) — fails fast', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(400, { message: 'invalid recipient' }));
    vi.stubGlobal('fetch', fetchMock);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createEmailClient({ apiKey: 'k', from: 'a@b.com', sleep });

    await expect(client.send(INPUT)).rejects.toBeInstanceOf(EmailError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry a 401 (invalid API key) — retrying can only ever fail the same way', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(401, { message: 'invalid key' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createEmailClient({ apiKey: 'bad', from: 'a@b.com', sleep: vi.fn() });

    await expect(client.send(INPUT)).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
