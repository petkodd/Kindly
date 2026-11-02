'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/apiClient';
import { useEmailVerified, UNVERIFIED_REASON } from '@/hooks/useEmailVerified';
import { ParentPicker } from '@/components/ParentPicker';
import { EmptyParentState } from '@/components/EmptyParentState';
import { ParentGate } from '@/components/ParentGate';
import { EMAIL_RE } from '@/lib/validation';
import { FormStatus } from '@/components/FormStatus';
import { StatusBadge } from '@/components/StatusBadge';
import { inputCls, labelCls } from '@/lib/formStyles';

interface Recipient {
  id: string;
  email: string;
  status: 'pending' | 'accepted';
}

export default function ReferralsPage() {
  return (
    <ParentGate>
      {({ parents, selected, setSelected }) => {
        const isSelf = parents.find((p) => p.id === selected)?.relationship === 'self';
        return (
          <div className="mx-auto max-w-2xl space-y-10">
            <div>
              <p className="eyebrow">Invite &amp; share</p>
              <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
                {isSelf ? 'People & referrals' : 'Family & referrals'}
              </h1>
              <p className="mt-2 text-base text-muted">
                {isSelf
                  ? 'Invite people you’d like to keep in the loop on your weekly summary, and share Dearly with a referral code.'
                  : 'Invite family members to receive the weekly summary, and share Dearly with a referral code.'}
              </p>
            </div>

            {parents.length === 0 ? (
              <EmptyParentState />
            ) : (
              <section className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink">Summary recipients</h2>
                  <p className="mt-1 text-base text-muted">
                    People you invite here receive the weekly summary once they accept.
                  </p>
                </div>
                <ParentPicker parents={parents} selected={selected} onSelect={setSelected} />
                {selected && <RecipientsPanel key={selected} parentId={selected} isSelf={isSelf} />}
              </section>
            )}

            <ReferralCodeSection />
          </div>
        );
      }}
    </ParentGate>
  );
}

function RecipientsPanel({ parentId, isSelf }: { parentId: string; isSelf: boolean }) {
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await api.get<{ recipients: Recipient[] }>(`/api/parents/${parentId}/recipients`);
      setRecipients(r.recipients);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load recipients.');
    }
  }, [parentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <FormStatus kind="error" message={error} />;
  if (!recipients) return <p className="text-base text-muted">Loading recipients…</p>;

  return (
    <div className="rounded-xl border border-line bg-cloud p-6">
      {recipients.length === 0 ? (
        <p className="text-base text-muted">
          {isSelf
            ? 'No recipients yet. Invite someone below.'
            : 'No recipients yet. Invite a family member below.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {recipients.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <span className="break-all text-base text-ink">{r.email}</span>
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge tone={r.status === 'accepted' ? 'positive' : 'neutral'}>
                  {r.status === 'accepted' ? 'Accepted' : 'Pending'}
                </StatusBadge>
                <RevokeButton consentId={r.id} email={r.email} onRevoked={load} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <InviteForm parentId={parentId} isSelf={isSelf} onInvited={load} />
    </div>
  );
}

function RevokeButton({ consentId, email, onRevoked }: { consentId: string; email: string; onRevoked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function revoke() {
    if (!window.confirm('Remove this recipient? They will stop receiving summaries.')) return;
    setFailed(false);
    setBusy(true);
    try {
      await api.post(`/api/consent/${consentId}/revoke`);
      onRevoked();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="flex items-center gap-2">
      {failed && (
        <span role="alert" className="text-base font-semibold text-error">
          Couldn’t remove
        </span>
      )}
      <button
        type="button"
        onClick={revoke}
        disabled={busy}
        aria-label={`Remove ${email}`}
        className="inline-flex min-h-[2.75rem] items-center rounded-xl px-3 text-base font-semibold text-error underline underline-offset-4 disabled:opacity-60"
      >
        Remove
      </button>
    </span>
  );
}

function InviteForm({
  parentId,
  isSelf,
  onInvited,
}: {
  parentId: string;
  isSelf: boolean;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const blockedUnverified = useEmailVerified() === false;

  async function invite(e?: FormEvent) {
    e?.preventDefault();
    setStatus('');
    setError('');
    setInvalid(false);
    if (blockedUnverified) return;
    if (!EMAIL_RE.test(email.trim())) {
      setInvalid(true);
      return setError('Please enter a valid email.');
    }
    setBusy(true);
    try {
      await api.post(`/api/parents/${parentId}/invite-sibling`, { email: email.trim() });
      setEmail('');
      setStatus('Invitation sent. They’ll appear as “pending” until they accept.');
      onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={invite} noValidate className="mt-6 border-t border-line pt-6">
      <label htmlFor="invite-email" className={labelCls}>
        {isSelf ? 'Invite someone to follow along' : 'Invite a family member'}
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <input
          id="invite-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="their@email.com"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={invalid ? 'invite-error' : undefined}
          className={inputCls}
        />
        <button
          type="submit"
          disabled={busy || blockedUnverified}
          aria-describedby={blockedUnverified ? 'invite-blocked-reason' : undefined}
          className="btn-primary shrink-0 disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Send invite'}
        </button>
      </div>
      {blockedUnverified && (
        <p id="invite-blocked-reason" className="mt-3 text-base text-error">
          {UNVERIFIED_REASON}
        </p>
      )}
      <FormStatus kind="error" id="invite-error" message={error} className="mt-3" />
      <FormStatus kind="success" message={status} className="mt-3" />
    </form>
  );
}

interface Redemption {
  redeemed_at: string;
  status: 'pending' | 'credited';
}

function ReferralCodeSection() {
  const [code, setCode] = useState<string | null>(null);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ code: string | null; redemptions?: Redemption[] }>('/api/referrals')
      .then((r) => {
        setCode(r.code);
        setRedemptions(r.redemptions ?? []);
      })
      .catch(() => {
        /* keep the section usable — the buyer can still get a code */
      })
      .finally(() => setLoaded(true));
  }, []);

  async function generate() {
    setError('');
    setBusy(true);
    try {
      const r = await api.post<{ code: string }>('/api/referrals');
      setCode(r.code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not get a code.');
    } finally {
      setBusy(false);
    }
  }

  const link = code && typeof window !== 'undefined' ? `${window.location.origin}/?ref=${code}` : null;

  async function copy(what: 'code' | 'link') {
    const text = what === 'code' ? code : link;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard unavailable — the code is visible to copy manually */
    }
  }

  return (
    <section className="rounded-xl border border-line bg-cloud p-6">
      <h2 className="text-lg font-semibold text-ink">Give a month, get a month</h2>
      <p className="mt-1 text-base text-muted">
        Share your code or link with another family. They enter the code when they create their account
        or start their trial. After their first payment, you each get one month free, taken off your
        next bill.
      </p>
      <p className="mt-2 text-base text-muted">
        Each code works once, for a family new to Dearly. Once it’s used, you can get a new one here.
      </p>
      {!loaded ? (
        <p className="mt-4 text-base text-muted">Loading…</p>
      ) : code ? (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded-lg border border-line bg-mist px-4 py-2 text-lg font-semibold tracking-widest text-ink">
              {code}
            </code>
            <button type="button" onClick={() => copy('code')} className="btn-secondary">
              {copied === 'code' ? 'Copied' : 'Copy code'}
            </button>
            {link && (
              <button type="button" onClick={() => copy('link')} className="btn-secondary">
                {copied === 'link' ? 'Copied' : 'Copy link'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="btn-primary mt-4 disabled:opacity-60"
        >
          {busy ? 'Getting your code…' : redemptions.length > 0 ? 'Get a new code' : 'Get my code'}
        </button>
      )}
      <FormStatus kind="error" message={error} className="mt-3" />

      {redemptions.length > 0 && (
        <div className="mt-6 border-t border-line pt-6">
          <h3 className="text-base font-semibold text-ink">Families who used your code</h3>
          <ul className="mt-3 space-y-3">
            {redemptions.map((r, i) => (
              <li key={`${r.redeemed_at}-${i}`} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-base text-ink">
                  Joined {new Date(r.redeemed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
                <StatusBadge tone={r.status === 'credited' ? 'positive' : 'neutral'}>
                  {r.status === 'credited' ? 'Credited: 1 free month' : 'Pending: waiting for their first payment'}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
