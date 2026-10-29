import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ForgotPasswordForm, ResetPasswordForm } from '../src/components/PasswordResetForms';

// Like Next 15: search params follow the live URL, including history.replaceState.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('ResetPasswordForm', () => {
  it('keeps the token after stripping it from the URL, and posts it with the new password', async () => {
    window.history.replaceState(null, '', '/login/reset?token=raw-token-123');
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    render(<ResetPasswordForm />);
    await waitFor(() => expect(window.location.search).toBe('')); // out of history
    // Re-render after the URL change must still show the form, not "invalid link".
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'brand-new-pass' } });
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'brand-new-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));

    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/password/reset');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'raw-token-123', password: 'brand-new-pass' });
  });

  it('checks length and that both entries match before calling the API', async () => {
    window.history.replaceState(null, '', '/login/reset?token=t');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<ResetPasswordForm />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'brand-new-pass' } });
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'different-pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/don.t match/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('without a token, explains and links to request a new one', () => {
    window.history.replaceState(null, '', '/login/reset');
    render(<ResetPasswordForm />);
    expect(screen.getByRole('heading', { name: /isn.t valid/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /request a new one/ }).getAttribute('href')).toBe('/login/forgot');
  });
});

describe('ForgotPasswordForm', () => {
  it('shows the same neutral confirmation for any email', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true })));
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sarah@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy();
    expect(screen.getByText(/If there.s a Dearly account for/)).toBeTruthy();
  });
});
