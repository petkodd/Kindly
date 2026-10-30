'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';

const inputCls =
  'mt-2 w-full rounded-xl border border-line bg-cloud px-4 py-3 text-lg text-ink focus:border-sage';

/** /login/forgot — ask for a reset link. Same answer whether or not the email has an account. */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.includes('@')) return setError('Please enter a valid email address.');
    setBusy(true);
    try {
      await api.post('/api/auth/password/forgot', { email });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-sm space-y-5" role="status">
        <h1 className="font-display text-3xl font-semibold text-ink">Check your email</h1>
        <p className="text-lg text-ink">
          If there&rsquo;s a Dearly account for <strong>{email}</strong>, we&rsquo;ve sent it a link to choose a new
          password. The link works for 30 minutes.
        </p>
        <Link href="/login" className="text-base text-sageDeep underline">Back to sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-sm space-y-5" noValidate>
      <h1 className="font-display text-3xl font-semibold text-ink">Forgot your password?</h1>
      <p className="text-lg text-muted">Enter your email and we&rsquo;ll send you a link to choose a new one.</p>
      <div>
        <label htmlFor="forgot-email" className="block text-base font-semibold text-ink">Email</label>
        <input id="forgot-email" type="email" autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@example.com" />
      </div>
      {error && <p role="alert" className="text-base text-clay">{error}</p>}
      <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">
        {busy ? 'Please wait…' : 'Send reset link'}
      </button>
      <p className="text-base text-muted">
        Remembered it? <Link href="/login" className="text-sageDeep underline">Sign in</Link>
      </p>
    </form>
  );
}

/** /login/reset?token=… — choose a new password. Signs out every device; the user then signs in again. */
export function ResetPasswordForm() {
  return (
    <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
      <ResetEntry />
    </Suspense>
  );
}

function ResetEntry() {
  // Captured once: Next syncs useSearchParams with history.replaceState, so
  // after the URL is cleaned below the live query no longer has the token.
  const urlToken = useSearchParams().get('token') ?? '';
  const [token] = useState(urlToken);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Keep the one-time token out of browser history once the page has it.
    if (token) window.history.replaceState(null, '', '/login/reset');
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Your new password must be at least 8 characters.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true);
    try {
      await api.post('/api/auth/password/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!token && !done) {
    return (
      <div className="mx-auto max-w-sm space-y-5">
        <h1 className="font-display text-3xl font-semibold text-ink">This link isn&rsquo;t valid</h1>
        <p className="text-lg text-muted">
          Please use the link from your email, or <Link href="/login/forgot" className="text-sageDeep underline">request a new one</Link>.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-sm space-y-5" role="status">
        <h1 className="font-display text-3xl font-semibold text-ink">Password changed</h1>
        <p className="text-lg text-ink">
          For your security we&rsquo;ve signed you out everywhere. Sign in with your new password.
        </p>
        <Link href="/login" className="btn-primary w-full">Sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-sm space-y-5" noValidate>
      <h1 className="font-display text-3xl font-semibold text-ink">Choose a new password</h1>
      <div>
        <label htmlFor="reset-password" className="block text-base font-semibold text-ink">New password</label>
        <input id="reset-password" type="password" autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="At least 8 characters" />
      </div>
      <div>
        <label htmlFor="reset-confirm" className="block text-base font-semibold text-ink">Type it again</label>
        <input id="reset-confirm" type="password" autoComplete="new-password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
      </div>
      {error && <p role="alert" className="text-base text-clay">{error}</p>}
      <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-60">
        {busy ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  );
}
