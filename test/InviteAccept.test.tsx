import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { InviteAccept } from '../src/components/InviteAccept';

let tokenValue: string | null = 'tok123';
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => tokenValue }),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Handler = (init?: RequestInit) => Response;
function stubFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  tokenValue = 'tok123';
});

describe('InviteAccept', () => {
  it('accepts a valid invite token', async () => {
    const fetchMock = stubFetch({ 'POST /api/invites/accept': () => json({ ok: true }) });
    render(<InviteAccept />);
    expect(await screen.findByText(/you're on the list|you.re on the list/i)).toBeTruthy();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/invites/accept'));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ token: 'tok123' });
  });

  it('shows an invalid-invitation message when the token is rejected', async () => {
    stubFetch({ 'POST /api/invites/accept': () => json({ error: { code: 'not_found', message: 'no' } }, 404) });
    render(<InviteAccept />);
    expect(await screen.findByText(/isn.t valid/i)).toBeTruthy();
  });

  it('with no token, shows the invalid-invitation message without calling the API', async () => {
    tokenValue = null;
    const fetchMock = stubFetch({});
    render(<InviteAccept />);
    expect(await screen.findByText(/isn.t valid/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
