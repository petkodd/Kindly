'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/apiClient';
import { useParents } from '@/hooks/useParents';
import { ParentPicker } from '@/components/ParentPicker';
import { EmptyParentState } from '@/components/EmptyParentState';
import { EMAIL_RE } from '@/lib/validation';

interface Recipient {
  id: string;
  email: string;
  status: 'pending' | 'accepted';
}

export default function ReferralsPage() {
  const { parents, selected, setSelected, loadError } = useParents();

  if (loadError) return <p className="text-base text-clay">{loadError}</p>;
  if (!parents) return <p className="text-base text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <div>
        <p className="eyebrow">Invite &amp; share</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Family &amp; referrals</h1>
        <p className="mt-2 text-base text-muted">
          Invite family members to receive the weekly summary, and share Kindly with a referral
          code.
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
          {parents.length > 1 && (
            <ParentPicker parents={parents} selected={selected} onSelect={setSelected} />
          )}
          {selected && <RecipientsPanel key={selected} parentId={selected} />}
        </section>
      )}

      <ReferralCodeSection />
    </div>
  );
}

function RecipientsPanel({ parentId }: { parentId: string }) {
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

  if (error) return <p className="text-base text-clay">{error}</p>;
  if (!recipients) return <p className="text-base text-muted">Loading recipients…</p>;

  return (
    <div className="rounded-xl border border-line bg-cloud p-6">
      {recipients.length === 0 ? (
        <p className="text-base text-muted">No recipients yet. Invite a family member below.</p>
      ) : (
        <ul className="space-y-3">
          {recipients.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4">
              <span className="text-base text-ink">{r.email}</span>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                    r.status === 'accepted'
                      ? 'bg-sage text-cloud'
                      : 'border border-line bg-mist text-muted'
                  }`}
                >
                  {r.status}
                </span>
                <RevokeButton consentId={r.id} onRevoked={load} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <InviteForm parentId={parentId} onInvited={load} />
    </div>
  );
}

function RevokeButton({ consentId, onRevoked }: { consentId: string; onRevoked: () => void }) {
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
      {failed && <span className="text-xs text-clay">Couldn’t remove</span>}
      <button
        type="button"
        onClick={revoke}
        disabled={busy}
        className="text-sm text-clay underline disabled:opacity-60"
      >
        Remove
      </button>
    </span>
  );
}

function InviteForm({ parentId, onInvited }: { parentId: string; onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  async function invite() {
    setStatus('');
    if (!EMAIL_RE.test(email.trim())) return setStatus('Please enter a valid email.');
    setBusy(true);
    try {
      await api.post(`/api/parents/${parentId}/invite-sibling`, { email: email.trim() });
      setEmail('');
      setStatus('Invitation sent. They’ll appear as “pending” until they accept.');
      onInvited();
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t border-line pt-6">
      <label htmlFor="invite-email" className="block text-base font-semibold text-ink">
        Invite a family member
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <input
          id="invite-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="their@email.com"
          className="w-full rounded-xl border border-line bg-mist px-4 py-3 text-lg text-ink focus:border-sage"
        />
        <button
          type="button"
          onClick={invite}
          disabled={busy}
          className="btn-primary shrink-0 disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Send invite'}
        </button>
      </div>
      {status && <p className="mt-3 text-sm text-muted">{status}</p>}
    </div>
  );
}

function ReferralCodeSection() {
  const [code, setCode] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<{ code: string | null }>('/api/referrals')
      .then((r) => setCode(r.code))
      .catch(() => {
        /* keep the section usable — the buyer can still generate a code */
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
      setError(err instanceof ApiError ? err.message : 'Could not generate a code.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the code is visible to copy manually */
    }
  }

  return (
    <section className="rounded-xl border border-line bg-cloud p-6">
      <h2 className="text-lg font-semibold text-ink">Your referral code</h2>
      <p className="mt-1 text-base text-muted">
        Share Kindly with another family. They enter this code when they sign up.
      </p>
      {!loaded ? (
        <p className="mt-4 text-base text-muted">Loading…</p>
      ) : code ? (
        <div className="mt-4 flex items-center gap-3">
          <code className="rounded-lg border border-line bg-mist px-4 py-2 text-lg font-semibold tracking-widest text-ink">
            {code}
          </code>
          <button type="button" onClick={copy} className="btn-secondary">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="btn-primary mt-4 disabled:opacity-60"
        >
          {busy ? 'Generating…' : 'Generate a code'}
        </button>
      )}
      {error && <p className="mt-3 text-sm text-clay">{error}</p>}
    </section>
  );
}
