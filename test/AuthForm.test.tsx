import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AuthForm } from '../src/components/AuthForm';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Route a stubbed fetch by method + path so each test declares only what it needs. */
function stubFetch(routes: Record<string, (init?: RequestInit) => Response>) {
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

function fillAndSubmit(mode: 'login' | 'signup' = 'login') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sarah@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough' } });
  fireEvent.click(screen.getByRole('button', { name: mode === 'login' ? /sign in/i : /create account/i }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockReset();
});

describe('AuthForm', () => {
  it('validates the password length client-side before calling the API', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/at least 8 characters/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('redirects a buyer with an activated parent straight to family-summary', async () => {
    stubFetch({
      'POST /api/auth/login': () => json({ user: {} }),
      'GET /api/parents': () => json({ parents: [{ id: 'p1', activated_at: '2026-01-01T00:00:00Z' }] }),
    });
    render(<AuthForm mode="login" />);
    fillAndSubmit();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/family-summary'));
  });

  it('sends a buyer with no activated parent into onboarding', async () => {
    stubFetch({
      'POST /api/auth/login': () => json({ user: {} }),
      'GET /api/parents': () => json({ parents: [] }),
    });
    render(<AuthForm mode="login" />);
    fillAndSubmit();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/onboarding'));
  });

  it('sends a buyer whose only parent is unactivated (incomplete onboarding) into onboarding', async () => {
    stubFetch({
      'POST /api/auth/signup': () => json({ user: {} }),
      'GET /api/parents': () => json({ parents: [{ id: 'p1', activated_at: null }] }),
    });
    render(<AuthForm mode="signup" />);
    fillAndSubmit('signup');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/onboarding'));
  });

  it('falls back to onboarding if the post-login parents lookup fails', async () => {
    stubFetch({
      'POST /api/auth/login': () => json({ user: {} }),
      'GET /api/parents': () => json({ error: { code: 'error', message: 'boom' } }, 500),
    });
    render(<AuthForm mode="login" />);
    fillAndSubmit();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/onboarding'));
  });

  it('surfaces the API error message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_credentials', message: 'Invalid email or password.' } }), { status: 401, headers: { 'content-type': 'application/json' } })),
    );
    render(<AuthForm mode="login" />);
    fillAndSubmit();
    expect(await screen.findByText('Invalid email or password.')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
