'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/apiClient';
import { readReferralCookie } from '@/lib/referralCode';
import { FormStatus } from '@/components/FormStatus';
import { inputCls, labelCls } from '@/lib/formStyles';

/** Shared copy: what a referral code gets you (chat 11). */
export const REFERRAL_TERMS =
  'After your first payment, you and the family who referred you each get one month free, taken off your next bill.';

/**
 * Optional referral code on the onboarding checkout step (chat 11). Prefilled
 * from the ?ref= cookie. A buyer who already used a code (e.g. at signup)
 * sees a confirmation instead of the field.
 */
export function ReferralCodeField() {
  const [state, setState] = useState<'loading' | 'open' | 'applied'>('loading');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get<{ used_code?: boolean }>('/api/referrals')
      .then((r) => {
        if (!active) return;
        setState(r.used_code ? 'applied' : 'open');
      })
      .catch(() => active && setState('open'))
      .finally(() => {
        if (active) setCode((c) => c || readReferralCookie(document.cookie) || '');
      });
    return () => {
      active = false;
    };
  }, []);

  async function apply() {
    setError('');
    if (!code.trim()) return setError('Please enter a referral code.');
    setBusy(true);
    try {
      await api.post('/api/referrals/redeem', { code: code.trim() });
      setState('applied');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not apply that code.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return null;

  if (state === 'applied') {
    return (
      <div className="rounded-xl border border-line bg-cloud p-4" role="status">
        <p className="text-base font-semibold text-ink">Referral code applied</p>
        <p className="mt-1 text-base text-muted">{REFERRAL_TERMS}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void apply();
      }}
      noValidate
      className="rounded-xl border border-line bg-cloud p-4"
    >
      <label htmlFor="referral-code" className={labelCls}>
        Referral code <span className="font-normal text-muted">(optional)</span>
      </label>
      <p id="referral-code-help" className="mt-1 text-base text-muted">{REFERRAL_TERMS}</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          id="referral-code"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'referral-code-help referral-code-error' : 'referral-code-help'}
          className={`uppercase tracking-widest ${inputCls}`}
        />
        <button type="submit" disabled={busy} className="btn-secondary shrink-0 disabled:opacity-60">
          {busy ? 'Applying…' : 'Apply code'}
        </button>
      </div>
      <FormStatus kind="error" message={error} id="referral-code-error" className="mt-3" />
    </form>
  );
}
