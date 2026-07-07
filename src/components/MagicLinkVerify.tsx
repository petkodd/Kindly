'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/apiClient';

// useSearchParams() opts this out of static prerendering unless it sits under a
// Suspense boundary — same pattern as InviteAccept and /app/talk's token exchange.
export function MagicLinkVerify() {
  return (
    <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
      <VerifyEntry />
    </Suspense>
  );
}

type State = 'checking' | 'invalid';

function VerifyEntry() {
  const token = useSearchParams().get('token');
  const router = useRouter();
  const [state, setState] = useState<State>(token ? 'checking' : 'invalid');

  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .post('/api/auth/magic/verify', { token })
      .then(() => {
        if (active) {
          router.push('/app/account');
          router.refresh();
        }
      })
      .catch(() => {
        if (active) setState('invalid');
      });
    return () => {
      active = false;
    };
  }, [token, router]);

  if (state === 'checking') {
    return <p className="text-lg text-muted">Signing you in…</p>;
  }

  return (
    <div className="max-w-md">
      <h1 className="font-display text-3xl font-semibold text-ink">This link isn&rsquo;t valid</h1>
      <p className="mt-4 text-lg text-muted">
        It may have expired or already been used. Request a new sign-in link from the{' '}
        <Link href="/login" className="text-sage underline">sign in</Link> page.
      </p>
    </div>
  );
}
