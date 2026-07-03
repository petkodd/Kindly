'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';

interface Account {
  id: string;
  email: string;
  full_name: string | null;
  is_admin: boolean;
  created_at: string;
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
        if (err instanceof ApiError && err.status === 401) router.replace('/login');
        else setLoadError('Could not load your account.');
      });
  }, [router]);

  if (loadError) return <p className="text-base text-clay">{loadError}</p>;
  if (!account) return <p className="text-base text-muted">Loading…</p>;

  return (
    <div className="mx-auto max-w-lg space-y-10">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">Your account</h1>
        <p className="mt-2 text-base text-muted">{account.email}</p>
      </div>
      <NameSection account={account} onUpdated={setAccount} />
      <PasswordSection />
      <DangerSection />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-cloud p-6">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function NameSection({ account, onUpdated }: { account: Account; onUpdated: (a: Account) => void }) {
  const [name, setName] = useState(account.full_name ?? '');
  const [status, setStatus] = useState('');
  async function save() {
    setStatus('');
    try {
      const r = await api.patch<{ account: Account }>('/api/me', { full_name: name });
      onUpdated(r.account);
      setStatus('Saved.');
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not save.');
    }
  }
  return (
    <Card title="Display name">
      <input
        value={name} onChange={(e) => setName(e.target.value)}
        className="w-full rounded-xl border border-line bg-mist px-4 py-3 text-lg text-ink focus:border-sage"
        placeholder="Your name"
      />
      <button type="button" onClick={save} className="btn-primary">Save name</button>
      {status && <p className="text-sm text-muted">{status}</p>}
    </Card>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [status, setStatus] = useState('');
  async function change() {
    setStatus('');
    try {
      await api.post('/api/me/password', { current_password: current, new_password: next });
      setCurrent(''); setNext('');
      setStatus('Password changed. Other devices have been signed out.');
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not change password.');
    }
  }
  return (
    <Card title="Change password">
      <input
        type="password" autoComplete="current-password" value={current}
        onChange={(e) => setCurrent(e.target.value)} placeholder="Current password"
        className="w-full rounded-xl border border-line bg-mist px-4 py-3 text-lg text-ink focus:border-sage"
      />
      <input
        type="password" autoComplete="new-password" value={next}
        onChange={(e) => setNext(e.target.value)} placeholder="New password (min 8)"
        className="w-full rounded-xl border border-line bg-mist px-4 py-3 text-lg text-ink focus:border-sage"
      />
      <button type="button" onClick={change} className="btn-primary">Change password</button>
      {status && <p className="text-sm text-muted">{status}</p>}
    </Card>
  );
}

function DangerSection() {
  const router = useRouter();
  async function logout() {
    await api.post('/api/auth/logout');
    router.replace('/login');
  }
  async function remove() {
    if (!window.confirm('Delete your account? This cannot be undone.')) return;
    await api.del('/api/me');
    router.replace('/');
  }
  return (
    <Card title="Session & account">
      <button type="button" onClick={logout} className="btn-secondary">Sign out</button>
      <button type="button" onClick={remove} className="text-base text-clay underline">
        Delete my account
      </button>
    </Card>
  );
}
