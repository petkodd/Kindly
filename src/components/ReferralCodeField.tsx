'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/apiClient';
import { readReferralCookie } from '@/lib/referralCode';

/** Shared copy: what a referral code gets you (chat 11). */
export const REFERRAL_TERMS =
  'After your first paid month, you and the family who referred you each get one month free, taken off your next bill.';

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
    <div className="rounded-xl border border-line bg-cloud p-4">
      <label htmlFor="referral-code" className="block text-base font-semibold text-ink">
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
          aria-describedby="referral-code-help"
          className="w-full rounded-xl border border-line bg-mist px-4 py-3 text-lg uppercase tracking-widest text-ink focus:border-sage"
        />
        <button type="button" onClick={apply} disabled={busy} className="btn-secondary shrink-0 disabled:opacity-60">
          {busy ? 'Applying…' : 'Apply code'}
        </button>
      </div>
      {error && <p className="mt-3 text-base text-clay" role="alert">{error}</p>}
    </div>
  );
}
