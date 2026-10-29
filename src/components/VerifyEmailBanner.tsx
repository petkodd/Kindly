'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/apiClient';

/**
 * Shown across the buyer app until the account's email is confirmed. Explains
 * what is held back (inviting family, sending summaries — both send email in
 * the buyer's name) and offers to resend the link.
 */
export function VerifyEmailBanner() {
  const [email, setEmail] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .get<{ account: { email: string; email_verified_at?: string | null } }>('/api/me')
      .then((r) => {
        if (active && r.account && !r.account.email_verified_at) setEmail(r.account.email);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (!email) return null;

  async function resend() {
    setBusy(true);
    setNote('');
    try {
      const r = await api.post<{ ok: boolean; already_verified?: boolean }>('/api/auth/verify-email/resend');
      setNote(r.already_verified ? 'Your email is already confirmed.' : `Sent. Check ${email} for the link.`);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : 'Could not send the link. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="status" className="border-b border-line bg-cloud">
      <div className="container-k flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-base text-ink">
        <p className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <strong>Please confirm your email.</strong> Until you do, you can set everything up, but you can&rsquo;t invite
          family or send summaries. We sent a link to {email}.
        </p>
        <button type="button" onClick={resend} disabled={busy} className="btn-secondary min-h-[2.75rem] px-5 text-base disabled:opacity-60">
          {busy ? 'Sending…' : 'Resend link'}
        </button>
        {note && <p className="w-full text-base text-muted">{note}</p>}
      </div>
    </div>
  );
}
