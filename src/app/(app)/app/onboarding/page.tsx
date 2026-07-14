'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';
import { inputOnPageCls } from '@/lib/formStyles';

interface Parent {
  id: string;
  first_name: string;
  activated_at?: string | null;
}

const RELATIONSHIPS = ['mother', 'father', 'grandparent', 'aunt', 'uncle', 'other'] as const;

// Onboarding fields sit on the bare page (no card), and labels sit above them.
const fieldCls = `mt-2 ${inputOnPageCls}`;

// useSearchParams() (needed to read the Stripe redirect's ?billing=/parent_id=
// query params) requires a Suspense boundary in the App Router, or the page
// fails static prerendering at build time.
export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl"><p className="mt-6 text-lg text-muted">Loading…</p></div>}>
      <OnboardingWizard />
    </Suspense>
  );
}

function OnboardingWizard() {
  const searchParams = useSearchParams();
  const billingResult = searchParams.get('billing'); // 'success' | 'cancel' | null
  const returningParentId = searchParams.get('parent_id');

  const [step, setStep] = useState(1);
  const [parent, setParent] = useState<Parent | null>(null);
  const [talkToken, setTalkToken] = useState('');
  // Stripe Checkout is a full-page redirect, so returning from it loses the
  // in-memory wizard state — re-fetch the parent by id and jump to the
  // billing step instead of starting the wizard over.
  const [loadingReturn, setLoadingReturn] = useState(!!returningParentId);
  const [returnError, setReturnError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  // A fresh visit (no ?parent_id= from Stripe): check for an existing,
  // not-yet-activated parent before defaulting to ProfileStep, so abandoning
  // checkout mid-flow (or just reloading the page) resumes instead of
  // creating a second, orphaned parent every time.
  const [checkingResume, setCheckingResume] = useState(!returningParentId);

  useEffect(() => {
    if (!returningParentId) return;
    let active = true;
    setLoadingReturn(true);
    setReturnError('');
    (async () => {
      try {
        const { parent: p } = await api.get<{ parent: Parent }>(`/api/parents/${returningParentId}`);
        if (!active) return;
        setParent(p);
        setStep(4);
      } catch (err) {
        // Don't silently fall through to step 1 — the user may have just paid
        // via Stripe; losing that context with no explanation is the bug being
        // fixed here. Offer a retry instead of restarting the whole wizard.
        if (active) {
          setReturnError(err instanceof ApiError ? err.message : 'Could not load your progress. Please try again.');
        }
      } finally {
        if (active) setLoadingReturn(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [returningParentId, retryCount]);

  useEffect(() => {
    if (returningParentId) return; // the other effect handles this visit
    let active = true;
    (async () => {
      try {
        const { parents } = await api.get<{ parents: Parent[] }>('/api/parents');
        const incomplete = parents.find((p) => !p.activated_at);
        if (active && incomplete) {
          // Consent recording is idempotent (POST .../consent uses ensure()),
          // so resuming at the consent step is always safe even if it was
          // already recorded before the buyer abandoned checkout.
          setParent(incomplete);
          setStep(3);
        }
      } catch {
        /* non-fatal — worst case the buyer starts a fresh parent */
      } finally {
        if (active) setCheckingResume(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returningParentId]);

  if (loadingReturn || checkingResume) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="mt-6 text-lg text-muted">Loading…</p>
      </div>
    );
  }

  if (returnError) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mt-6 font-display text-3xl font-semibold text-ink">We couldn’t load your progress</h1>
        <p className="mt-4 text-lg text-muted">{returnError}</p>
        <p className="mt-2 text-base text-muted">
          If you completed payment with Stripe, it went through — this is just a hiccup loading the page.
        </p>
        <button
          type="button"
          onClick={() => setRetryCount((n) => n + 1)}
          className="btn-primary mt-6 w-full"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">Set up the gift</p>
      <p className="mt-2 text-base text-muted">Step {Math.min(step, 5)} of 5</p>
      {step === 1 && <ProfileStep onDone={(p) => { setParent(p); setStep(2); }} />}
      {step === 2 && parent && <MemoriesStep parent={parent} onDone={() => setStep(3)} />}
      {step === 3 && parent && <ConsentStep parent={parent} onDone={() => setStep(4)} />}
      {step === 4 && parent && (
        <BillingStep parent={parent} billingResult={billingResult} onDone={() => setStep(5)} />
      )}
      {step === 5 && parent && (
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
        <input id="ob-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={fieldCls} placeholder="e.g. Robert" />
      </div>
      <div>
        <label htmlFor="ob-rel" className="block text-base font-semibold text-ink">Your relationship</label>
        <select id="ob-rel" value={relationship} onChange={(e) => setRelationship(e.target.value as typeof relationship)} className={fieldCls}>
          {RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="ob-pron" className="block text-base font-semibold text-ink">Pronouns (optional)</label>
        <input id="ob-pron" value={pronouns} onChange={(e) => setPronouns(e.target.value)} className={fieldCls} placeholder="she/her, he/him…" />
      </div>
      <div>
        <label htmlFor="ob-city" className="block text-base font-semibold text-ink">City (optional)</label>
        <input id="ob-city" value={city} onChange={(e) => setCity(e.target.value)} className={fieldCls} placeholder="Where they live" />
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
        <input id="ob-person" value={person} onChange={(e) => setPerson(e.target.value)} className={fieldCls} placeholder="e.g. their late wife, Margaret" />
      </div>
      <div>
        <label htmlFor="ob-home" className="block text-base font-semibold text-ink">Where they’re from</label>
        <input id="ob-home" value={hometown} onChange={(e) => setHometown(e.target.value)} className={fieldCls} placeholder="e.g. Detroit" />
      </div>
      <div>
        <label htmlFor="ob-enjoys" className="block text-base font-semibold text-ink">Something they love</label>
        <input id="ob-enjoys" value={enjoys} onChange={(e) => setEnjoys(e.target.value)} className={fieldCls} placeholder="e.g. jazz, gardening" />
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

  async function next() {
    setError('');
    if (!agreed) return setError('Please confirm you have permission before continuing.');
    setBusy(true);
    try {
      await api.post(`/api/parents/${parent.id}/consent`, { kind: 'buyer_attestation' });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
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
      <button type="button" onClick={next} disabled={busy} className="btn-primary w-full disabled:opacity-60">
        {busy ? 'Saving…' : 'Continue'}
      </button>
    </div>
  );
}

function BillingStep({
  parent, billingResult, onDone,
}: { parent: Parent; billingResult: string | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(billingResult === 'success');

  // Returning from a successful Stripe Checkout: the webhook may take a
  // moment to land, but activation only needs the consent already recorded —
  // it does not itself re-check billing (the talk-session gate does that on
  // every use, which is what actually enforces payment).
  useEffect(() => {
    if (billingResult !== 'success') return;
    (async () => {
      try {
        await api.post(`/api/parents/${parent.id}/activate`);
        onDone();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not confirm your trial. Please try again.');
        setConfirming(false);
      }
    })();
    // Only re-run if the parent/result we're confirming for actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingResult, parent.id]);

  async function startTrial() {
    setError('');
    setBusy(true);
    try {
      const { url, already_subscribed: alreadySubscribed } = await api.post<{ url: string | null; already_subscribed?: boolean }>(
        '/api/billing/checkout',
        { parent_id: parent.id },
      );
      if (alreadySubscribed) {
        // A subscription already exists (e.g. an earlier checkout succeeded
        // but the follow-up activate() call failed transiently) — the route
        // refused to start a second one. Just finish activating.
        await api.post(`/api/parents/${parent.id}/activate`);
        onDone();
        return;
      }
      window.location.href = url as string;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start your trial.');
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="mt-6 space-y-5">
        <h1 className="font-display text-3xl font-semibold text-ink">Confirming your trial…</h1>
        <p className="text-lg text-muted">One moment while we finish setting things up.</p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-5">
      <h1 className="font-display text-3xl font-semibold text-ink">Start your free trial</h1>
      <p className="text-lg text-muted">
        Try Kindly free for 7 days. We’ll ask for a card to hold your spot — you won’t be
        charged until the trial ends, and you can cancel anytime before then.
      </p>
      {billingResult === 'cancel' && (
        <p className="text-base text-clay">Checkout was canceled — no charge was made. You can try again below.</p>
      )}
      {error && <p className="text-base text-clay">{error}</p>}
      <button type="button" onClick={startTrial} disabled={busy} className="btn-primary w-full disabled:opacity-60">
        {busy ? 'Redirecting…' : 'Start 7-day free trial'}
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
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  // A bare token is meaningless to the parent — /app/talk only reads it from
  // the ?token= query param, with no manual-entry UI. The link must be complete.
  const talkUrl = talkToken && typeof window !== 'undefined'
    ? `${window.location.origin}/app/talk?token=${talkToken}`
    : '';

  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

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

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(talkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the link is still visible to copy manually */
    }
  }

  async function shareLink() {
    try {
      await navigator.share({ title: 'Talk with Kindly', url: talkUrl });
    } catch {
      /* user canceled the share sheet, or it failed — copy is still available */
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <h1 className="font-display text-3xl font-semibold text-ink">{parent.first_name} is all set 🎉</h1>
      <p className="text-lg text-muted">Create a private talk link to hand off to {parent.first_name}.</p>
      {talkToken ? (
        <div className="space-y-3 rounded-xl border border-line bg-cloud p-6">
          <p className="text-base font-semibold text-ink">Talk link (shown once — save it now):</p>
          <code className="block break-all rounded-lg bg-mist px-3 py-2 text-sm text-ink">{talkUrl}</code>
          <div className="flex gap-3">
            <button type="button" onClick={copyLink} className="btn-secondary flex-1">
              {copied ? 'Copied' : 'Copy link'}
            </button>
            {canShare && (
              <button type="button" onClick={shareLink} className="btn-secondary flex-1">
                Share
              </button>
            )}
          </div>
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
