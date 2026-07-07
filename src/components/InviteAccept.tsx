'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/apiClient';

// useSearchParams() opts this out of static prerendering unless it sits under a
// Suspense boundary (Next.js CSR-bailout rule) — same pattern as /app/talk's
// token exchange.
export function InviteAccept() {
  return (
    <Suspense fallback={<p className="text-lg text-muted">Loading…</p>}>
      <AcceptEntry />
    </Suspense>
  );
}

type State = 'checking' | 'accepted' | 'invalid';

function AcceptEntry() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<State>(token ? 'checking' : 'invalid');

  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .post('/api/invites/accept', { token })
      .then(() => {
        if (active) setState('accepted');
      })
      .catch(() => {
        if (active) setState('invalid');
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (state === 'checking') {
    return <p className="text-lg text-muted">Confirming your invitation…</p>;
  }

  if (state === 'invalid') {
    return (
      <div className="max-w-md">
        <h1 className="font-display text-3xl font-semibold text-ink">This invitation isn&rsquo;t valid</h1>
        <p className="mt-4 text-lg text-muted">
          The link may have expired or already been used. Ask your family member to send a new invitation from
          their Kindly account.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md">
      <h1 className="font-display text-3xl font-semibold text-ink">You&rsquo;re on the list 💛</h1>
      <p className="mt-4 text-lg text-muted">
        You&rsquo;ll receive a respectful weekly summary by email — never a raw transcript, and only what&rsquo;s
        safe to share.
      </p>
    </div>
  );
}
