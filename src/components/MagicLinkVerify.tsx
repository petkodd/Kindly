'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, resolvePostLoginPath } from '@/lib/apiClient';
import { safeNextPath } from '@/lib/nextPath';

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
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  // Set by signup when the buyer started from a gift CTA (validated again here).
  const next = safeNextPath(searchParams.get('next'));
  const router = useRouter();
  const [state, setState] = useState<State>(token ? 'checking' : 'invalid');

  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .post('/api/auth/magic/verify', { token })
      .then(async () => {
        if (!active) return;
        // resolvePostLoginPath() does its own network round-trip — re-check
        // `active` after it resolves, not just before, or a component
        // unmounted mid-lookup still fires a stale navigation.
        const path = next ?? (await resolvePostLoginPath());
        if (!active) return;
        router.push(path);
        router.refresh();
      })
      .catch(() => {
        if (active) setState('invalid');
      });
    return () => {
      active = false;
    };
  }, [token, next, router]);

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
