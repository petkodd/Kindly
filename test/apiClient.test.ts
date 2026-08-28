import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, ApiError, resolvePostLoginPath, takeCachedParentsForOnboarding } from '../src/lib/apiClient';

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

function mockFetch(status: number, body?: unknown) {
  const init: ResponseInit = { status, headers: { 'content-type': 'application/json' } };
  const res = status === 204 ? new Response(null, init) : new Response(JSON.stringify(body ?? null), init);
  vi.stubGlobal('fetch', vi.fn(async () => res));
}

describe('apiClient', () => {
  it('returns the parsed body on success', async () => {
    mockFetch(200, { account: { id: 'u1' } });
    const out = await api.get<{ account: { id: string } }>('/api/me');
    expect(out.account.id).toBe('u1');
  });

  it('throws a typed ApiError from the error envelope', async () => {
    mockFetch(409, { error: { code: 'conflict', message: 'Email exists.' } });
    const err = (await api.post('/api/auth/signup', { email: 'a@b.co' }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('conflict');
    expect(err.message).toBe('Email exists.');
  });

  it('returns undefined for a 204 (no content)', async () => {
    mockFetch(204);
    expect(await api.post('/api/auth/logout')).toBeUndefined();
  });

  it('falls back to a generic message when there is no envelope', async () => {
    mockFetch(500, null);
    const err = (await api.get('/api/me').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Something went wrong.');
  });

  it('forwards extra headers (e.g. the parent talk Bearer token) and still sets Content-Type for a body', async () => {
    const fetchSpy = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await api.post('/api/talk/message', { content: 'hi' }, { Authorization: 'Bearer tok123' });
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok123');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends no headers object when there is neither a body nor extra headers', async () => {
    const fetchSpy = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    await api.get('/api/me');
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toBeUndefined();
  });
});

describe('resolvePostLoginPath', () => {
  it('caches the fetched parents list when routing to onboarding, so a follow-up read doesn\'t need a fetch', async () => {
    mockFetch(200, { parents: [{ id: 'p1', first_name: 'Robert', activated_at: null }] });
    const path = await resolvePostLoginPath();
    expect(path).toBe('/app/onboarding');

    const cached = takeCachedParentsForOnboarding<{ id: string; first_name: string }>();
    expect(cached).toEqual([{ id: 'p1', first_name: 'Robert', activated_at: null }]);
  });

  it('does not cache when routing to family-summary (nothing for onboarding to reuse)', async () => {
    mockFetch(200, { parents: [{ id: 'p1', activated_at: '2026-01-01T00:00:00Z' }] });
    const path = await resolvePostLoginPath();
    expect(path).toBe('/app/family-summary');
    expect(takeCachedParentsForOnboarding()).toBeNull();
  });
});

describe('takeCachedParentsForOnboarding', () => {
  it('returns null and clears storage when nothing is cached', () => {
    expect(takeCachedParentsForOnboarding()).toBeNull();
  });

  it('is single-use — a second read after the first returns null', async () => {
    mockFetch(200, { parents: [{ id: 'p1', activated_at: null }] });
    await resolvePostLoginPath();
    expect(takeCachedParentsForOnboarding()).not.toBeNull();
    expect(takeCachedParentsForOnboarding()).toBeNull();
  });

  it('ignores a stale entry past the TTL', () => {
    sessionStorage.setItem(
      'dearly:post-login-parents-cache',
      JSON.stringify({ parents: [{ id: 'p1' }], cachedAt: Date.now() - 60_000 }),
    );
    expect(takeCachedParentsForOnboarding()).toBeNull();
  });
});
