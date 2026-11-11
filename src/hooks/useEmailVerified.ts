'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';

/**
 * Whether the buyer's email is confirmed: true / false, or null while loading
 * (or if /api/me failed — then callers keep their controls enabled and the
 * server's 403 email_unverified remains the real gate). Used to show invite and
 * send-summary as disabled with an inline reason (chat 7 follow-up).
 */
export function useEmailVerified(): boolean | null {
  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    api
      .get<{ account: { email_verified_at?: string | null } }>('/api/me')
      .then((r) => active && setVerified(!!r.account.email_verified_at))
      .catch(() => active && setVerified(null));
    return () => {
      active = false;
    };
  }, []);
  return verified;
}

export const UNVERIFIED_REASON =
  'Confirm your email first — this sends email in your name. Use the “Resend link” button at the top of the page if you need a new link.';
