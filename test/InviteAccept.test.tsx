import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

const PREVIEW = 'GET /api/invites/accept?token=tok123';
const preview = (over: Record<string, unknown> = {}) => () =>
  json({ invite: { inviter_first_name: 'Anna', parent_first_name: 'Robert', status: 'pending', ...over } });

describe('InviteAccept', () => {
  it('shows who invited them and what they will receive, and does NOT accept on page load (email scanners)', async () => {
    const fetchMock = stubFetch({ [PREVIEW]: preview() });
    render(<InviteAccept />);
    expect(await screen.findByRole('heading', { name: /Anna invited you to Robert.s weekly summary/i })).toBeTruthy();
    expect(screen.getByText(/Never a transcript/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yes, send me weekly summaries' })).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('accepts only when the button is clicked', async () => {
    const fetchMock = stubFetch({ [PREVIEW]: preview(), 'POST /api/invites/accept': () => json({ ok: true }) });
    render(<InviteAccept />);
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, send me weekly summaries' }));
    expect(await screen.findByText(/you.re on the list/i)).toBeTruthy();
    const call = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ token: 'tok123' });
  });

  it('falls back to "A family member" when the inviter has no name on file', async () => {
    stubFetch({ [PREVIEW]: preview({ inviter_first_name: null }) });
    render(<InviteAccept />);
    expect(await screen.findByRole('heading', { name: /A family member invited you/i })).toBeTruthy();
  });

  it('an already-accepted invite says so without a button', async () => {
    stubFetch({ [PREVIEW]: preview({ status: 'accepted' }) });
    render(<InviteAccept />);
    expect(await screen.findByText(/you.re on the list/i)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows an invalid-invitation message when the token is rejected', async () => {
    stubFetch({ [PREVIEW]: () => json({ error: { code: 'not_found', message: 'no' } }, 404) });
    render(<InviteAccept />);
    expect(await screen.findByText(/isn.t valid/i)).toBeTruthy();
  });

  it('shows the expired message for a 410', async () => {
    stubFetch({ [PREVIEW]: () => json({ error: { code: 'expired', message: 'old' } }, 410) });
    render(<InviteAccept />);
    expect(await screen.findByText(/has expired/i)).toBeTruthy();
  });

  it('with no token, shows the invalid-invitation message without calling the API', async () => {
    tokenValue = null;
    const fetchMock = stubFetch({});
    render(<InviteAccept />);
    expect(await screen.findByText(/isn.t valid/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
