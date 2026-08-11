import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import OnboardingPage from '../src/app/(app)/app/onboarding/page';

// Stable across renders (see component-test-router-mock guidance) — none of
// the effects under test key off router identity, but keeping this pattern
// consistent avoids a footgun if that ever changes.
const routerPush = vi.fn();
const routerReplace = vi.fn();
let searchParams = new URLSearchParams({ parent_id: 'p1', invite: 'RAW_INVITE_TOKEN_ABC' });
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  useSearchParams: () => searchParams,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Handler = (init?: RequestInit) => Response;

function stubFetch(routes: Record<string, Handler>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url}`;
    calls.push(key);
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

const PARENT = { id: 'p1', first_name: 'Robert' };

function baseRoutes(overrides: Record<string, Handler> = {}) {
  return {
    'GET /api/me': () => json({ account: { full_name: 'Sarah' } }),
    'GET /api/parents/p1': () => json({ parent: PARENT }),
    'GET /api/parents/p1/subscription': () => json({ subscription: null, is_current: false }),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  searchParams = new URLSearchParams({ parent_id: 'p1', invite: 'RAW_INVITE_TOKEN_ABC' });
});

describe('OnboardingPage — Founding Family Beta (invited user)', () => {
  it('shows the Founding Family Beta heading and "no card required" copy, not the Stripe selector', async () => {
    stubFetch(baseRoutes());
    render(<OnboardingPage />);
    expect(await screen.findByText(/Join the Founding Family Beta/i)).toBeTruthy();
    expect(screen.getByText(/no card required/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Annual' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Monthly' })).toBeNull();
    expect(screen.queryByText(/Start 7-day free trial/i)).toBeNull();
  });

  it('activating calls the beta endpoint (not Stripe checkout) and advances to Step 6', async () => {
    let activateCalls = 0;
    stubFetch(
      baseRoutes({
        'POST /api/billing/beta/activate': (init) => {
          activateCalls++;
          expect(JSON.parse(String(init?.body))).toEqual({ parent_id: 'p1', invite_token: 'RAW_INVITE_TOKEN_ABC' });
          return json({ ok: true, already_active: false });
        },
        'POST /api/parents/p1/activate': () => json({ parent: PARENT }),
      }),
    );
    render(<OnboardingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /continue with free beta/i }));

    await waitFor(() => expect(screen.queryByText(/Join the Founding Family Beta/i)).toBeNull());
    expect(activateCalls).toBe(1);
    // Landed on DoneStep (gift path — this test's PARENT has no relationship: 'self').
    expect(await screen.findByText(/is all set/i)).toBeTruthy();
  });

  it('double-clicking the activation button submits only once', async () => {
    const { calls } = stubFetch(
      baseRoutes({
        'POST /api/billing/beta/activate': () => json({ ok: true, already_active: false }),
        'POST /api/parents/p1/activate': () => json({ parent: PARENT }),
      }),
    );
    render(<OnboardingPage />);
    const button = await screen.findByRole('button', { name: /continue with free beta/i });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(calls.filter((c) => c === 'POST /api/billing/beta/activate')).toHaveLength(1));
  });

  it('shows a safe, generic error on an invalid/expired invite and does not advance', async () => {
    stubFetch(
      baseRoutes({
        'POST /api/billing/beta/activate': () =>
          json({ error: { code: 'invalid_invite', message: 'This invitation link is invalid, expired, or already used.' } }, 400),
      }),
    );
    render(<OnboardingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /continue with free beta/i }));
    expect(await screen.findByText(/invalid, expired, or already used/i)).toBeTruthy();
    // Still on the beta screen — did not advance to Step 6.
    expect(screen.getByText(/Join the Founding Family Beta/i)).toBeTruthy();
  });

  it('a buyer returning to Step 5 after a prior successful activation is redirected forward without re-activating', async () => {
    stubFetch(
      baseRoutes({
        'GET /api/parents/p1/subscription': () => json({ subscription: { status: 'beta' }, is_current: true }),
      }),
    );
    render(<OnboardingPage />);
    expect(await screen.findByText(/is all set/i)).toBeTruthy();
    expect(screen.queryByText(/Join the Founding Family Beta/i)).toBeNull();
  });
});

describe('OnboardingPage — non-invited user (no ?invite= param)', () => {
  it('keeps the existing Stripe trial UI', async () => {
    searchParams = new URLSearchParams({ parent_id: 'p1' });
    stubFetch(baseRoutes());
    render(<OnboardingPage />);
    expect(await screen.findByText(/Start your free trial/i)).toBeTruthy();
    expect(screen.queryByText(/Join the Founding Family Beta/i)).toBeNull();
  });
});
