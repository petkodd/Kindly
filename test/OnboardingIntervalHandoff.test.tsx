import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OnboardingPage from '../src/app/(app)/app/onboarding/page';

// Simulates arriving from the pricing page's "Choose Family" link with a
// Monthly selection already made (?interval=month) — the toggle-handoff fix.
// A separate file from OnboardingBillingStep.test.tsx because the
// next/navigation mock's searchParams is fixed per file.
const searchParams = new URLSearchParams({ parent_id: 'p1', interval: 'month' });
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = routes[`${method} ${url}`];
    if (!handler) throw new Error(`unexpected fetch: ${method} ${url}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OnboardingPage — carries the pricing page\'s interval choice through', () => {
  it('?interval=month lands on BillingStep already showing Monthly, not the Annual default', async () => {
    stubFetch({
      'GET /api/me': () => json({ account: { full_name: 'Sarah' } }),
      'GET /api/parents/p1': () => json({ parent: { id: 'p1', first_name: 'Robert' } }),
    });
    render(<OnboardingPage />);
    await screen.findByText(/Start your free trial/i);
    expect(screen.getByRole('button', { name: 'Monthly' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/\$59\.00\/month/)).toBeTruthy();
  });
});
