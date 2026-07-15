import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AuthStatus } from '../src/components/AuthStatus';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AuthStatus', () => {
  it('shows "Sign in" when the visitor has no session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, 401),
    ));
    render(<AuthStatus />);
    expect(await screen.findByRole('link', { name: /sign in/i })).toBeTruthy();
  });

  it('shows the display name instead of "Sign in" once /api/me resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      json({ account: { email: 'maria@example.com', full_name: 'Maria Ivanova' } }),
    ));
    render(<AuthStatus />);
    const link = await screen.findByRole('link', { name: /maria ivanova/i });
    expect(link.getAttribute('href')).toBe('/app/account');
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });

  it('falls back to the email when the account has no display name set', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      json({ account: { email: 'maria@example.com', full_name: null } }),
    ));
    render(<AuthStatus />);
    expect(await screen.findByRole('link', { name: 'maria@example.com' })).toBeTruthy();
  });
});
