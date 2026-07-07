import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AuthForm } from '../src/components/AuthForm';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

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

  it('posts credentials and redirects to the account page on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ user: {} }), { status: 200, headers: { 'content-type': 'application/json' } })),
    );
    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sarah@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/account'));
  });

  it('surfaces the API error message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_credentials', message: 'Invalid email or password.' } }), { status: 401, headers: { 'content-type': 'application/json' } })),
    );
    render(<AuthForm mode="login" />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sarah@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Invalid email or password.')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
