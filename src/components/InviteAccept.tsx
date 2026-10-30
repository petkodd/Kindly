'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';

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

interface InvitePreview {
  inviter_first_name: string | null;
  parent_first_name: string;
  status: 'pending' | 'accepted';
}

type State = 'loading' | 'ready' | 'accepting' | 'accepted' | 'invalid' | 'expired';

/**
 * The invite page loads a read-only preview (GET) and asks first. Only the
 * "Yes, send me weekly summaries" click POSTs the acceptance — email security
 * scanners that open links must never sign someone up (chat 10).
 */
function AcceptEntry() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<State>(token ? 'loading' : 'invalid');
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .get<{ invite: InvitePreview }>(`/api/invites/accept?token=${encodeURIComponent(token)}`)
      .then((r) => {
        if (!active) return;
        setInvite(r.invite);
        setState(r.invite.status === 'accepted' ? 'accepted' : 'ready');
      })
      .catch((err) => {
        // 410: a real invite that is older than 14 days.
        if (active) setState(err instanceof ApiError && err.status === 410 ? 'expired' : 'invalid');
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function accept() {
    if (!token || state === 'accepting') return;
    setError('');
    setState('accepting');
    try {
      await api.post('/api/invites/accept', { token });
      setState('accepted');
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) return setState('expired');
      if (err instanceof ApiError && err.status === 404) return setState('invalid');
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setState('ready');
    }
  }

  if (state === 'loading') {
    return <p className="text-lg text-muted">Loading your invitation…</p>;
  }

  if (state === 'expired') {
    return (
      <div className="max-w-md">
        <h1 className="font-display text-3xl font-semibold text-ink">This invitation has expired</h1>
        <p className="mt-4 text-lg text-muted">
          Invitations last 14 days. Ask your family member to send a new one from their Dearly account.
        </p>
      </div>
    );
  }

  if (state === 'invalid' || !invite) {
    return (
      <div className="max-w-md">
        <h1 className="font-display text-3xl font-semibold text-ink">This invitation isn&rsquo;t valid</h1>
        <p className="mt-4 text-lg text-muted">
          The link may have expired or already been used. Ask your family member to send a new invitation from
          their Dearly account.
        </p>
      </div>
    );
  }

  const parentName = invite.parent_first_name;

  if (state === 'accepted') {
    return (
      <div className="max-w-md" role="status">
        <h1 className="font-display text-3xl font-semibold text-ink">You&rsquo;re on the list 💛</h1>
        <p className="mt-4 text-lg text-muted">
          You&rsquo;ll receive a respectful weekly summary about {parentName} by email — never a raw transcript, and
          only what&rsquo;s safe to share.
        </p>
      </div>
    );
  }

  const inviter = invite.inviter_first_name ?? 'A family member';

  return (
    <div className="max-w-md">
      <h1 className="font-display text-3xl font-semibold text-ink">
        {inviter} invited you to {parentName}&rsquo;s weekly summary
      </h1>
      <p className="mt-4 text-lg text-ink">
        {parentName} talks with Dearly, an AI companion. Once a week you&rsquo;d get a short, warm email about how{' '}
        {parentName}&rsquo;s week went.
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-6 text-lg text-muted">
        <li>Never a transcript, and nothing {parentName} hasn&rsquo;t agreed to share.</li>
        <li>No account or password needed.</li>
        <li>{inviter === 'A family member' ? 'They' : inviter} can remove you from the list at any time — just ask.</li>
      </ul>
      {error && <p className="mt-4 text-base text-clay">{error}</p>}
      <button
        type="button"
        onClick={accept}
        disabled={state === 'accepting'}
        className="btn-primary mt-8 w-full disabled:opacity-60"
      >
        {state === 'accepting' ? 'One moment…' : 'Yes, send me weekly summaries'}
      </button>
      <p className="mt-4 text-base text-muted">Not interested? You can simply close this page. Nothing happens.</p>
    </div>
  );
}
