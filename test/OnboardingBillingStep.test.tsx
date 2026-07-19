import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import OnboardingPage from '../src/app/(app)/app/onboarding/page';

// Returning with only ?parent_id= (no billing=success) lands the wizard
// directly on step 4 (BillingStep) via the "resume after Stripe redirect"
// path, without needing to drive steps 0-3 first.
const searchParams = new URLSearchParams({ parent_id: 'p1' });
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Handler = (init?: RequestInit) => Response;

function stubFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const PARENT = { id: 'p1', first_name: 'Robert' };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function baseRoutes(overrides: Record<string, Handler> = {}) {
  return {
    'GET /api/me': () => json({ account: { full_name: 'Sarah' } }),
    'GET /api/parents/p1': () => json({ parent: PARENT }),
    ...overrides,
  };
}

describe('OnboardingPage — BillingStep interval toggle', () => {
  it('defaults to Annual and shows the annual price/savings', async () => {
    stubFetch(baseRoutes());
    render(<OnboardingPage />);
    expect(await screen.findByText(/Start your free trial/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Annual' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/\$566\.40\/year/)).toBeTruthy();
    expect(screen.getByText(/save 20%/i)).toBeTruthy();
  });

  it('starting the trial in the default Annual state submits interval: year', async () => {
    let checkoutBody: unknown = null;
    stubFetch(
      baseRoutes({
        'POST /api/billing/checkout': (init) => {
          checkoutBody = JSON.parse(String(init?.body));
          return json({ url: 'https://checkout.stripe.com/session_annual' });
        },
      }),
    );
    render(<OnboardingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /start 7-day free trial/i }));
    await waitFor(() => expect(checkoutBody).toEqual({ parent_id: 'p1', interval: 'year' }));
  });

  it('switching to Monthly updates the price shown and what startTrial submits', async () => {
    let checkoutBody: unknown = null;
    stubFetch(
      baseRoutes({
        'POST /api/billing/checkout': (init) => {
          checkoutBody = JSON.parse(String(init?.body));
          return json({ url: 'https://checkout.stripe.com/session_monthly' });
        },
      }),
    );
    render(<OnboardingPage />);
    await screen.findByText(/Start your free trial/i);

    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(screen.getByText(/\$59\.00\/month/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /start 7-day free trial/i }));
    await waitFor(() => expect(checkoutBody).toEqual({ parent_id: 'p1', interval: 'month' }));
  });
});
