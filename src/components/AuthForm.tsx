'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, resolvePostLoginPath } from '@/lib/apiClient';
import { safeNextPath, withNext } from '@/lib/nextPath';
import { normalizeReferralCode, readReferralCookie } from '@/lib/referralCode';

type Mode = 'login' | 'signup';

/**
 * `next` comes from the page's ?next= (set by the middleware or a gift CTA).
 * It is re-validated here and on the server, and carried through signup's
 * confirmation link so the buyer lands where they were going.
 */
export function AuthForm({
  mode,
  next: rawNext,
  referralCode: initialReferralCode,
}: {
  mode: Mode;
  next?: string | null;
  /** Signup only: a ?ref= code from the page URL (chat 11); falls back to the ref cookie. */
  referralCode?: string | null;
}) {
  const router = useRouter();
  const next = safeNextPath(rawNext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [magicSent, setMagicSent] = useState(false);
  // Signup never signs in directly (no account enumeration): it ends here, and
  // the emailed link confirms the address and signs the new account in.
  const [checkEmail, setCheckEmail] = useState(false);
  const [referralCode, setReferralCode] = useState(normalizeReferralCode(initialReferralCode) ?? '');
  useEffect(() => {
    if (mode !== 'signup') return;
    const fromCookie = readReferralCookie(document.cookie);
    if (fromCookie) setReferralCode((c) => c || fromCookie);
  }, [mode]);

  const isSignup = mode === 'signup';

  async function submit() {
    setError('');
    if (!email.includes('@')) return setError('Please enter a valid email address.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    try {
      if (isSignup) {
        const code = referralCode.trim();
        await api.post('/api/auth/signup', {
          email,
          password,
          ...(next ? { next } : {}),
          ...(code ? { referral_code: code } : {}),
        });
        setCheckEmail(true);
        setBusy(false);
        return;
      }
      await api.post('/api/auth/login', { email, password });
      router.push(next ?? (await resolvePostLoginPath()));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  async function sendMagicLink() {
    setError('');
    if (!email.includes('@')) return setError('Please enter a valid email address.');
    setBusy(true);
    try {
      await api.post('/api/auth/magic', { email });
      setMagicSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (checkEmail) {
    return (
      <div className="mx-auto max-w-sm space-y-5" role="status">
        <h1 className="font-display text-3xl font-semibold text-ink">Check your email</h1>
        <p className="text-lg text-ink">
          We sent a link to <strong>{email}</strong>. Click it to confirm your email and finish creating your account.
        </p>
        <p className="text-base text-muted">
          The link works for 24 hours. Nothing there? Check your spam folder, or{' '}
          <button type="button" className="text-sageDeep underline" onClick={() => setCheckEmail(false)}>
            try again
          </button>
          .
        </p>
      </div>
    );
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
      {isSignup && (
        <div>
          <label htmlFor="referral-code" className="block text-base font-semibold text-ink">
            Referral code <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="referral-code" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false}
            value={referralCode} onChange={(e) => setReferralCode(e.target.value)}
            aria-describedby="referral-code-help"
            className="mt-2 w-full rounded-xl border border-line bg-cloud px-4 py-3 text-lg uppercase tracking-widest text-ink focus:border-sage"
          />
          <p id="referral-code-help" className="mt-1 text-sm text-muted">
            From a friend who uses Dearly? You’ll each get a free month after your first payment.
          </p>
        </div>
      )}
      {error && <p className="text-base text-clay">{error}</p>}
      <button type="button" onClick={submit} disabled={busy} className="btn-primary w-full disabled:opacity-60">
        {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
      </button>
      {!isSignup && (
        <p className="text-right">
          <Link href="/login/forgot" className="text-base text-sageDeep underline">
            Forgot password?
          </Link>
        </p>
      )}
      {!isSignup && (
        magicSent ? (
          <p className="text-sm text-muted">Check your email for a sign-in link. It expires in 15 minutes.</p>
        ) : (
          <button
            type="button"
            onClick={sendMagicLink}
            disabled={busy}
            className="w-full text-sm text-sage underline disabled:opacity-60"
          >
            Email me a sign-in link instead
          </button>
        )
      )}
      <p className="text-sm text-muted">
        {isSignup ? (
          <>Already have an account? <Link href={withNext('/login', next)} className="text-sage underline">Sign in</Link></>
        ) : (
          <>New to Dearly? <Link href={withNext('/signup', next)} className="text-sage underline">Create an account</Link></>
        )}
      </p>
    </div>
  );
}
