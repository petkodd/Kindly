'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, signOutAndRedirect } from '@/lib/apiClient';
import { inputCls, labelCls } from '@/lib/formStyles';
import { AlertContactForm, type AlertContact } from '@/components/AlertContactForm';
import { FormStatus } from '@/components/FormStatus';
import { Card } from '@/components/Card';

interface Account {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  created_at: string;
  email_verified_at?: string | null;
}

interface ParentSummary {
  id: string;
  first_name: string;
  relationship?: string;
}

/** What deleting the whole account removes — shown before confirming. */
const ACCOUNT_DELETE_ITEMS = [
  'your Dearly account and sign-in',
  'every parent profile, with their memories, conversations and weekly summaries',
  'every talk link (they stop working immediately)',
  'every family member invited to receive summaries',
];

/** What deleting one parent's profile removes — shown before confirming. */
function parentDeleteItems(firstName: string): string[] {
  return [
    `${firstName}’s profile and settings`,
    `everything Dearly remembers about ${firstName}`,
    `${firstName}’s conversations and weekly summaries`,
    `${firstName}’s talk link (it stops working immediately) and the family invited to their summaries`,
  ];
}

export default function AccountPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api
      .get<{ account: Account }>('/api/me')
      .then((r) => setAccount(r.account))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) void signOutAndRedirect(router);
        else setLoadError('Could not load your account. Please refresh the page.');
      });
  }, [router]);

  if (loadError) return <FormStatus kind="error" message={loadError} />;
  if (!account) return <p className="text-base text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-lg space-y-10">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">Your account</h1>
        <p className="mt-2 text-base text-muted">{account.email}</p>
      </div>
      <EmailSection account={account} />
      <NameSection account={account} onUpdated={setAccount} />
      <AlertsSection />
      <PasswordSection />
      <BillingSection />
      <DataSection />
      <ParentsSection />
      <DangerSection />
    </div>
  );
}

/**
 * One account section on the shared Card surface. With onSubmit, the body is a
 * <form> so Enter submits (chat 12).
 */
function Section({
  title,
  id,
  onSubmit,
  children,
}: {
  title: string;
  id?: string;
  onSubmit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card id={id}>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {onSubmit ? (
        <form
          noValidate
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {children}
        </form>
      ) : (
        <div className="mt-4 space-y-4">{children}</div>
      )}
    </Card>
  );
}

function Status({ text, error, id }: { text: string; error?: boolean; id?: string }) {
  return <FormStatus kind={error ? 'error' : 'success'} message={text} id={id} />;
}

/** Chat 7 follow-up: show whether the email is confirmed, with a resend button. */
function EmailSection({ account }: { account: Account }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: '' });
  const verified = !!account.email_verified_at;

  async function resend() {
    setBusy(true);
    setStatus({ text: '' });
    try {
      const r = await api.post<{ already_verified?: boolean }>('/api/auth/verify-email/resend');
      setStatus({ text: r.already_verified ? 'Your email is already confirmed.' : `Sent. Check ${account.email} for the link.` });
    } catch (err) {
      setStatus({ text: err instanceof ApiError ? err.message : 'Could not send the link. Please try again.', error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Email">
      <p className="text-base text-ink">
        {account.email} ·{' '}
        <strong className={verified ? 'text-sageDeep' : 'text-error'}>{verified ? 'Confirmed' : 'Not confirmed yet'}</strong>
      </p>
      {!verified && (
        <>
          <p className="text-base text-muted">
            Until you confirm it, you can&rsquo;t invite family or send summaries — both send email in your name.
          </p>
          <button type="button" onClick={resend} disabled={busy} className="btn-secondary disabled:opacity-60">
            {busy ? 'Sending…' : 'Resend link'}
          </button>
        </>
      )}
      <Status {...status} />
    </Section>
  );
}

function NameSection({ account, onUpdated }: { account: Account; onUpdated: (a: Account) => void }) {
  const [name, setName] = useState(account.full_name ?? '');
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setStatus({ text: '' });
    setBusy(true);
    try {
      const r = await api.patch<{ account: Account }>('/api/me', { full_name: name });
      onUpdated(r.account);
      setStatus({ text: 'Saved.' });
    } catch (err) {
      setStatus({ text: err instanceof ApiError ? err.message : 'Could not save.', error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Display name" onSubmit={save}>
      <label htmlFor="acc-name" className={labelCls}>Your name</label>
      <input
        id="acc-name" value={name} onChange={(e) => setName(e.target.value)}
        aria-invalid={status.error ? true : undefined}
        aria-describedby={status.error ? 'acc-name-status' : undefined}
        className={inputCls}
        placeholder="Your name"
      />
      <button type="submit" disabled={busy} className="btn-primary disabled:opacity-60">
        {busy ? 'Saving…' : 'Save name'}
      </button>
      <Status {...status} id="acc-name-status" />
    </Section>
  );
}

/** Decision D2: the emergency-alert phone, editable here as well as in onboarding. */
function AlertsSection() {
  const [initial, setInitial] = useState<AlertContact | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api
      .get<{ alert_contact: AlertContact }>('/api/me/alert-contact')
      .then((r) => active && setInitial(r.alert_contact))
      .catch(() => active && setError('Could not load your alert settings. Please refresh the page.'))
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, []);
  return (
    <Section title="Emergency alerts" id="alerts">
      <p className="text-base text-muted">
        If your family member says something that sounds like an emergency, we email you right away — and text you too if
        you add a mobile number and agree below.
      </p>
      {error ? <Status text={error} error /> : loaded ? <AlertContactForm initial={initial} /> : <p className="text-base text-muted">Loading…</p>}
    </Section>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: '' });
  async function change() {
    setStatus({ text: '' });
    setBusy(true);
    try {
      await api.post('/api/me/password', { current_password: current, new_password: next });
      setCurrent(''); setNext('');
      setStatus({ text: 'Password changed. Other devices have been signed out.' });
    } catch (err) {
      setStatus({ text: err instanceof ApiError ? err.message : 'Could not change password.', error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Change password" onSubmit={change}>
      <label htmlFor="acc-current-pw" className={labelCls}>Current password</label>
      <input
        id="acc-current-pw" type="password" autoComplete="current-password" value={current}
        onChange={(e) => setCurrent(e.target.value)} placeholder="Current password"
        className={inputCls}
      />
      <label htmlFor="acc-new-pw" className={labelCls}>New password</label>
      <input
        id="acc-new-pw" type="password" autoComplete="new-password" value={next}
        onChange={(e) => setNext(e.target.value)} placeholder="At least 8 characters"
        aria-invalid={status.error ? true : undefined}
        aria-describedby={status.error ? 'acc-pw-status' : undefined}
        className={inputCls}
      />
      <button type="submit" disabled={busy} className="btn-primary disabled:opacity-60">
        {busy ? 'Changing…' : 'Change password'}
      </button>
      <Status {...status} id="acc-pw-status" />
    </Section>
  );
}

/** Stripe Billing Portal: card, invoices, cancel (POST /api/billing/portal). */
function BillingSection() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: '' });
  async function open() {
    setStatus({ text: '' });
    setBusy(true);
    try {
      const { url } = await api.post<{ url: string }>('/api/billing/portal');
      window.location.href = url;
    } catch (err) {
      setStatus({ text: err instanceof ApiError ? err.message : 'Could not open billing. Please try again.', error: true });
      setBusy(false);
    }
  }
  return (
    <Section title="Billing">
      <p className="text-base text-muted">Update your card, download invoices or cancel a plan on our payment provider&rsquo;s secure page.</p>
      <button type="button" onClick={open} disabled={busy} className="btn-secondary disabled:opacity-60">
        {busy ? 'Opening…' : 'Manage billing'}
      </button>
      <Status {...status} />
    </Section>
  );
}

/** GET /api/me/export as a file download (once an hour, server-enforced). */
function DataSection() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: '' });
  async function download() {
    setStatus({ text: '' });
    setBusy(true);
    try {
      const res = await fetch('/api/me/export');
      if (!res.ok) {
        let message = 'Could not prepare your data. Please try again.';
        try {
          message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
        } catch {
          /* keep the default */
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'dearly-export.json';
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      setStatus({ text: 'Your download has started.' });
    } catch (err) {
      setStatus({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Your data">
      <p className="text-base text-muted">
        Download a copy of your account, your family profiles, their memories, weekly summaries and recent conversations as a file. Available once an hour.
      </p>
      <button type="button" onClick={download} disabled={busy} className="btn-secondary disabled:opacity-60">
        {busy ? 'Preparing…' : 'Download my data'}
      </button>
      <Status {...status} />
    </Section>
  );
}

/** "Delete {parent}'s profile" — DELETE /api/parents/:id (cancels that parent's subscription). */
function ParentsSection() {
  const [parents, setParents] = useState<ParentSummary[] | null>(null);
  const [confirming, setConfirming] = useState<ParentSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: '' });

  useEffect(() => {
    api
      .get<{ parents: ParentSummary[] }>('/api/parents')
      .then((r) => setParents(r.parents))
      .catch(() => setStatus({ text: 'Could not load your family profiles.', error: true }));
  }, []);

  if (!parents || parents.length === 0) return status.text ? <Section title="Family profiles"><Status {...status} /></Section> : null;

  async function remove(p: ParentSummary) {
    setBusy(true);
    setStatus({ text: '' });
    try {
      await api.del(`/api/parents/${p.id}`);
      setParents((list) => (list ?? []).filter((x) => x.id !== p.id));
      setConfirming(null);
      setStatus({ text: `${p.first_name}’s profile was deleted and any subscription for it canceled.` });
    } catch (err) {
      setStatus({ text: err instanceof ApiError ? err.message : 'Could not delete the profile. Nothing was changed.', error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Family profiles">
      <ul className="space-y-3">
        {parents.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-base text-ink">{p.relationship === 'self' ? `${p.first_name} (you)` : p.first_name}</span>
            <button type="button" onClick={() => setConfirming(p)} className="inline-flex min-h-[2.75rem] items-center text-base font-semibold text-error underline underline-offset-4">
              Delete {p.first_name}&rsquo;s profile
            </button>
          </li>
        ))}
      </ul>
      {confirming && (
        <ConfirmDelete
          title={`Delete ${confirming.first_name}’s profile?`}
          items={parentDeleteItems(confirming.first_name)}
          billingNote={`Any subscription for ${confirming.first_name} is canceled, so you won’t be charged again for it.`}
          confirmLabel={`Delete ${confirming.first_name}’s profile`}
          busy={busy}
          onConfirm={() => void remove(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
      <Status {...status} />
    </Section>
  );
}

function ConfirmDelete({
  title, items, billingNote, confirmLabel, busy, onConfirm, onCancel,
}: {
  title: string; items: string[]; billingNote: string; confirmLabel: string; busy: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div role="alertdialog" aria-label={title} className="space-y-3 rounded-xl border-2 border-error bg-mist p-4">
      <p className="text-base font-semibold text-ink">{title}</p>
      <p className="text-base text-ink">This deletes:</p>
      <ul className="list-disc space-y-1 pl-6 text-base text-ink">
        {items.map((i) => <li key={i}>{i}</li>)}
      </ul>
      <p className="text-base text-ink">{billingNote}</p>
      <p className="text-base text-muted">
        It disappears from Dearly now and is permanently erased within 30 days. This can&rsquo;t be undone.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={onConfirm} disabled={busy} className="btn-primary !bg-error hover:!bg-ink disabled:opacity-60">
          {busy ? 'Deleting…' : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
          Keep it
        </button>
      </div>
    </div>
  );
}

function DangerSection() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'' | 'logout' | 'delete'>('');
  const [status, setStatus] = useState<{ text: string; error?: boolean }>({ text: '' });

  async function logout() {
    setBusy('logout');
    setStatus({ text: '' });
    try {
      await api.post('/api/auth/logout');
      router.replace('/login');
    } catch (err) {
      setStatus({ text: err instanceof ApiError ? err.message : 'Could not sign out. Please try again.', error: true });
      setBusy('');
    }
  }
  async function remove() {
    setBusy('delete');
    setStatus({ text: '' });
    try {
      await api.del('/api/me');
      router.replace('/');
    } catch (err) {
      setStatus({
        text: err instanceof ApiError ? err.message : 'Could not delete your account. Nothing was changed. Please try again.',
        error: true,
      });
      setBusy('');
    }
  }
  return (
    <Section title="Session & account">
      <button type="button" onClick={logout} disabled={busy !== ''} className="btn-secondary disabled:opacity-60">
        {busy === 'logout' ? 'Signing out…' : 'Sign out'}
      </button>
      <p className="text-base text-muted">Signing out signs you out on every device.</p>
      {confirming ? (
        <ConfirmDelete
          title="Delete your account?"
          items={ACCOUNT_DELETE_ITEMS}
          billingNote="Every subscription you pay for is canceled, so you won’t be charged again."
          confirmLabel="Delete my account"
          busy={busy === 'delete'}
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-[2.75rem] items-center text-base font-semibold text-error underline underline-offset-4">
          Delete my account
        </button>
      )}
      <Status {...status} />
    </Section>
  );
}
