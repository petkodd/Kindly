import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import OnboardingPage from '../src/app/(app)/app/onboarding/page';

// A fresh visit to /app/onboarding — no ?billing=/parent_id= from a Stripe redirect.
const searchParams = new URLSearchParams();
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
    const key = `${method} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch: ${key}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OnboardingPage — resuming instead of duplicating', () => {
  it('resumes an existing not-yet-activated parent at the consent step, instead of creating a new one', async () => {
    stubFetch({
      'GET /api/parents': () =>
        json({ parents: [{ id: 'p1', first_name: 'Robert', activated_at: null }] }),
    });
    render(<OnboardingPage />);

    // Lands on ConsentStep for the existing parent, not ProfileStep ("Who is this for?").
    expect(await screen.findByText(/one important step/i)).toBeTruthy();
    expect(screen.getAllByText(/Robert/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/who is this for/i)).toBeNull();
  });

  it('starts fresh at ProfileStep when every existing parent is already activated', async () => {
    stubFetch({
      'GET /api/parents': () =>
        json({ parents: [{ id: 'p1', first_name: 'Robert', activated_at: '2026-07-01T00:00:00Z' }] }),
    });
    render(<OnboardingPage />);
    expect(await screen.findByText(/who is this for/i)).toBeTruthy();
  });

  it('starts fresh at ProfileStep when the buyer has no parents at all', async () => {
    stubFetch({ 'GET /api/parents': () => json({ parents: [] }) });
    render(<OnboardingPage />);
    expect(await screen.findByText(/who is this for/i)).toBeTruthy();
  });

  it('degrades to ProfileStep (not a crash) if the resume check itself fails', async () => {
    stubFetch({
      'GET /api/parents': () => json({ error: { code: 'server_error', message: 'nope' } }, 500),
    });
    render(<OnboardingPage />);
    expect(await screen.findByText(/who is this for/i)).toBeTruthy();
  });
});
