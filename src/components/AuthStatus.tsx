'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/apiClient';

interface Account {
  email: string;
  full_name: string | null;
}

/**
 * Marketing-header auth control. Defaults to "Sign in" (matching the
 * server-rendered markup, so there's no hydration mismatch) and swaps to the
 * signed-in buyer's name/email once /api/me resolves — a logged-in visitor
 * should never be prompted to sign in again on the public pages.
 */
export function AuthStatus() {
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<{ account: Account }>('/api/me')
      .then((r) => {
        if (active) setAccount(r.account);
      })
      .catch(() => {
        /* not signed in, or the request failed — stay on "Sign in" */
      });
    return () => {
      active = false;
    };
  }, []);

  if (account) {
    return (
      <Link
        href="/app/account"
        className="max-w-[4.5rem] truncate text-sm text-muted transition-colors hover:text-ink sm:max-w-[9rem] sm:text-base"
        title={account.full_name || account.email}
      >
        {account.full_name || account.email}
      </Link>
    );
  }

  return (
    <Link href="/login" className="text-sm text-muted transition-colors hover:text-ink sm:text-base">
      Sign in
    </Link>
  );
}
