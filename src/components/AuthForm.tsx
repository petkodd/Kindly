'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/apiClient';

type Mode = 'login' | 'signup';

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isSignup = mode === 'signup';

  async function submit() {
    setError('');
    if (!email.includes('@')) return setError('Please enter a valid email address.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    try {
      await api.post(isSignup ? '/api/auth/signup' : '/api/auth/login', { email, password });
      router.push('/app/account');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-5">
      <h1 className="font-display text-3xl font-semibold text-ink">
        {isSignup ? 'Create your account' : 'Welcome back'}
      </h1>
      <div>
        <label htmlFor="email" className="block text-base font-semibold text-ink">Email</label>
        <input
          id="email" type="email" autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-2 w-full rounded-xl border border-line bg-cloud px-4 py-3 text-lg text-ink focus:border-sage"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-base font-semibold text-ink">Password</label>
        <input
          id="password" type="password"
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          value={password} onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="mt-2 w-full rounded-xl border border-line bg-cloud px-4 py-3 text-lg text-ink focus:border-sage"
          placeholder="At least 8 characters"
        />
      </div>
      {error && <p className="text-base text-clay">{error}</p>}
      <button type="button" onClick={submit} disabled={busy} className="btn-primary w-full disabled:opacity-60">
        {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
      </button>
      <p className="text-sm text-muted">
        {isSignup ? (
          <>Already have an account? <Link href="/login" className="text-sage underline">Sign in</Link></>
        ) : (
          <>New to Kindly? <Link href="/signup" className="text-sage underline">Create an account</Link></>
        )}
      </p>
    </div>
  );
}
