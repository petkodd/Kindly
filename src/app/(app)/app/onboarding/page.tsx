'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';

interface Parent {
  id: string;
  first_name: string;
}

const RELATIONSHIPS = ['mother', 'father', 'grandparent', 'aunt', 'uncle', 'other'] as const;

const inputCls =
  'mt-2 w-full rounded-xl border border-line bg-cloud px-4 py-3 text-lg text-ink focus:border-sage';

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [parent, setParent] = useState<Parent | null>(null);
  const [talkToken, setTalkToken] = useState('');

  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">Set up the gift</p>
      <p className="mt-2 text-base text-muted">Step {Math.min(step, 4)} of 4</p>
      {step === 1 && <ProfileStep onDone={(p) => { setParent(p); setStep(2); }} />}
      {step === 2 && parent && <MemoriesStep parent={parent} onDone={() => setStep(3)} />}
      {step === 3 && parent && <ConsentStep parent={parent} onDone={() => setStep(4)} />}
      {step === 4 && parent && (
        <DoneStep parent={parent} talkToken={talkToken} setTalkToken={setTalkToken} />
      )}
    </div>
  );
}

function ProfileStep({ onDone }: { onDone: (p: Parent) => void }) {
  const [firstName, setFirstName] = useState('');
  const [relationship, setRelationship] = useState<(typeof RELATIONSHIPS)[number]>('mother');
  const [pronouns, setPronouns] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function next() {
    setError('');
    if (!firstName.trim()) return setError("Please enter your parent's first name.");
    setBusy(true);
    try {
      const { parent } = await api.post<{ parent: Parent }>('/api/parents', {
        first_name: firstName.trim(),
        relationship,
        pronouns: pronouns.trim() || undefined,
        city: city.trim() || undefined,
      });
      onDone(parent);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <h1 className="font-display text-3xl font-semibold text-ink">Who is this for?</h1>
      <div>
        <label htmlFor="ob-name" className="block text-base font-semibold text-ink">Their first name</label>
        <input id="ob-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} placeholder="e.g. Robert" />
      </div>
      <div>
        <label htmlFor="ob-rel" className="block text-base font-semibold text-ink">Your relationship</label>
        <select id="ob-rel" value={relationship} onChange={(e) => setRelationship(e.target.value as typeof relationship)} className={inputCls}>
          {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="ob-pron" className="block text-base font-semibold text-ink">Pronouns (optional)</label>
        <input id="ob-pron" value={pronouns} onChange={(e) => setPronouns(e.target.value)} className={inputCls} placeholder="she/her, he/him…" />
      </div>
      <div>
        <label htmlFor="ob-city" className="block text-base font-semibold text-ink">City (optional)</label>
        <input id="ob-city" value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} placeholder="Where they live" />
      </div>
      {error && <p className="text-base text-clay">{error}</p>}
      <button type="button" onClick={next} disabled={busy} className="btn-primary w-full disabled:opacity-60">
        {busy ? 'Saving…' : 'Continue'}
      </button>
    </div>
  );
}

function MemoriesStep({ parent, onDone }: { parent: Parent; onDone: () => void }) {
  const [person, setPerson] = useState('');
  const [hometown, setHometown] = useState('');
  const [enjoys, setEnjoys] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function next() {
    setError('');
    setBusy(true);
    const seeds = [
      person.trim() && { layer: 'core', key: 'loved_one', value: person.trim() },
      hometown.trim() && { layer: 'core', key: 'hometown', value: hometown.trim() },
      enjoys.trim() && { layer: 'interest', key: 'enjoys', value: enjoys.trim() },
    ].filter(Boolean) as { layer: string; key: string; value: string }[];
    try {
      for (const s of seeds) {
        await api.post(`/api/parents/${parent.id}/memories`, { ...s, source: 'onboarding' });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save memories.');
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <h1 className="font-display text-3xl font-semibold text-ink">A few things about {parent.first_name}</h1>
      <p className="text-base text-muted">These help Kindly hold a warmer conversation. All optional — you can add more later.</p>
      <div>
        <label htmlFor="ob-person" className="block text-base font-semibold text-ink">Someone who matters to them</label>
        <input id="ob-person" value={person} onChange={(e) => setPerson(e.target.value)} className={inputCls} placeholder="e.g. their late wife, Margaret" />
      </div>
      <div>
        <label htmlFor="ob-home" className="block text-base font-semibold text-ink">Where they’re from</label>
        <input id="ob-home" value={hometown} onChange={(e) => setHometown(e.target.value)} className={inputCls} placeholder="e.g. Detroit" />
      </div>
      <div>
        <label htmlFor="ob-enjoys" className="block text-base font-semibold text-ink">Something they love</label>
        <input id="ob-enjoys" value={enjoys} onChange={(e) => setEnjoys(e.target.value)} className={inputCls} placeholder="e.g. jazz, gardening" />
      </div>
      {error && <p className="text-base text-clay">{error}</p>}
      <button type="button" onClick={next} disabled={busy} className="btn-primary w-full disabled:opacity-60">
        {busy ? 'Saving…' : 'Continue'}
      </button>
    </div>
  );
}

function ConsentStep({ parent, onDone }: { parent: Parent; onDone: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function activate() {
    setError('');
    if (!agreed) return setError('Please confirm you have permission before continuing.');
    setBusy(true);
    try {
      await api.post(`/api/parents/${parent.id}/consent`, { kind: 'buyer_attestation' });
      await api.post(`/api/parents/${parent.id}/activate`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not activate.');
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <h1 className="font-display text-3xl font-semibold text-ink">One important step</h1>
      <p className="text-lg text-muted">
        Kindly is only for people who want it. Please confirm {parent.first_name} is happy to talk with an AI companion.
      </p>
      <label className="flex items-start gap-3 rounded-xl border border-line bg-cloud p-4 text-base text-ink">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-5 w-5 rounded border-line" />
        I confirm I have {parent.first_name}’s permission to set up Kindly for them.
      </label>
      {error && <p className="text-base text-clay">{error}</p>}
      <button type="button" onClick={activate} disabled={busy} className="btn-primary w-full disabled:opacity-60">
        {busy ? 'Activating…' : 'Activate Kindly'}
      </button>
    </div>
  );
}

function DoneStep({
  parent, talkToken, setTalkToken,
}: { parent: Parent; talkToken: string; setTalkToken: (t: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function issueLink() {
    setError('');
    setBusy(true);
    try {
      const { token } = await api.post<{ token: string }>(`/api/parents/${parent.id}/access-link`);
      setTalkToken(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the link.');
    }
    setBusy(false);
  }

  return (
    <div className="mt-6 space-y-5">
      <h1 className="font-display text-3xl font-semibold text-ink">{parent.first_name} is all set 🎉</h1>
      <p className="text-lg text-muted">Create a private talk link to hand off to {parent.first_name}.</p>
      {talkToken ? (
        <div className="space-y-3 rounded-xl border border-line bg-cloud p-6">
          <p className="text-base font-semibold text-ink">Talk token (shown once — save it now):</p>
          <code className="block break-all rounded-lg bg-mist px-3 py-2 text-sm text-ink">{talkToken}</code>
          <p className="text-sm text-muted">Share this only with {parent.first_name}. It’s their private key to talk with Kindly.</p>
        </div>
      ) : (
        <button type="button" onClick={issueLink} disabled={busy} className="btn-primary w-full disabled:opacity-60">
          {busy ? 'Creating…' : 'Create talk link'}
        </button>
      )}
      {error && <p className="text-base text-clay">{error}</p>}
      <button type="button" onClick={() => router.push('/app/account')} className="btn-secondary w-full">
        Done
      </button>
    </div>
  );
}
