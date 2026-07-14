'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';
import { ParentPicker } from '@/components/ParentPicker';
import { EmptyParentState } from '@/components/EmptyParentState';
import { ParentGate } from '@/components/ParentGate';
import { inputCls } from '@/lib/formStyles';

interface Parent {
  id: string;
  first_name: string;
  relationship: string;
  pronouns: string | null;
  city: string | null;
  language: string;
  large_text: boolean;
  voice_first: boolean;
  speech_rate: 'slow' | 'normal';
  activated_at: string | null;
}

const LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'es-US', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
];

// Labels sit above each field, so add top spacing to the shared in-card input.
const fieldCls = `mt-2 ${inputCls}`;

export default function ParentProfilePage() {
  return (
    <ParentGate>
      {({ parents, selected, setSelected }) => (
        <div className="mx-auto max-w-2xl space-y-8">
          <div>
            <p className="eyebrow">Their profile</p>
            <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Parent profile</h1>
            <p className="mt-2 text-base text-muted">
              Tune how Kindly speaks with your parent — the accessibility settings that make each
              conversation comfortable for them.
            </p>
          </div>

          {parents.length === 0 ? (
            <EmptyParentState />
          ) : (
            <>
              <ParentPicker parents={parents} selected={selected} onSelect={setSelected} />
              {selected && <ProfilePanel key={selected} parentId={selected} />}
            </>
          )}
        </div>
      )}
    </ParentGate>
  );
}

function ProfilePanel({ parentId }: { parentId: string }) {
  const [parent, setParent] = useState<Parent | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    setParent(null);
    api
      .get<{ parent: Parent }>(`/api/parents/${parentId}`)
      .then((r) => {
        if (active) setParent(r.parent);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Could not load this profile.');
      });
    return () => {
      active = false;
    };
  }, [parentId]);

  if (error) return <p className="text-base text-clay">{error}</p>;
  if (!parent) return <p className="text-base text-muted">Loading profile…</p>;

  return (
    <div className="space-y-6">
      <ProfileForm parent={parent} onSaved={setParent} />
      {parent.relationship === 'self' && parent.activated_at && <TalkToKindlySection parentId={parent.id} />}
      {parent.activated_at && <BillingSection parentId={parent.id} />}
    </div>
  );
}

/**
 * Ongoing re-entry point for a self profile. The kindly_talk cookie set
 * during onboarding is long-lived (90 days) but not permanent, so this
 * re-runs the same access-link → talk/auth handshake on demand rather than
 * relying on the cookie alone.
 */
function TalkToKindlySection({ parentId }: { parentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function startTalking() {
    setError('');
    setBusy(true);
    try {
      const { token } = await api.post<{ token: string }>(`/api/parents/${parentId}/access-link`);
      await api.post('/api/talk/auth', { token });
      router.push('/app/talk');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start talking. Please try again.');
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-cloud p-6">
      <h2 className="text-lg font-semibold text-ink">Talk to Kindly</h2>
      {error && <p className="mt-2 text-base text-clay">{error}</p>}
      <button type="button" onClick={startTalking} disabled={busy} className="btn-primary mt-4 disabled:opacity-60">
        {busy ? 'One moment…' : 'Start talking'}
      </button>
    </section>
  );
}

interface SubscriptionInfo {
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  current_period_end: string | null;
}

/**
 * Billing status + a "start trial" recovery path. Needed because activation
 * and billing are separate gates (see conversationRepo.openSession) — a
 * parent can be activated with no current subscription (never went through
 * Stripe checkout, or a subscription lapsed past its grace period), and
 * otherwise has no way back into billing once past the onboarding wizard.
 */
function BillingSection({ parentId }: { parentId: string }) {
  const [loaded, setLoaded] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [isCurrent, setIsCurrent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get<{ subscription: SubscriptionInfo | null; is_current: boolean }>(`/api/parents/${parentId}/subscription`)
      .then((r) => {
        if (!active) return;
        setSubscription(r.subscription);
        setIsCurrent(r.is_current);
      })
      .catch(() => {
        /* keep the section usable — worst case the buyer just sees the trial CTA */
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [parentId]);

  async function startTrial() {
    setError('');
    setBusy(true);
    try {
      const { url, already_subscribed: alreadySubscribed } = await api.post<{ url: string | null; already_subscribed?: boolean }>(
        '/api/billing/checkout',
        { parent_id: parentId },
      );
      if (alreadySubscribed) {
        setIsCurrent(true);
        setBusy(false);
        return;
      }
      window.location.href = url as string;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start a trial.');
      setBusy(false);
    }
  }

  if (!loaded) return null;

  const statusLabel: Record<SubscriptionInfo['status'], string> = {
    trialing: 'Free trial',
    active: 'Active',
    past_due: 'Payment issue — grace period',
    canceled: 'Canceled',
  };

  return (
    <section className="rounded-xl border border-line bg-cloud p-6">
      <h2 className="text-lg font-semibold text-ink">Billing</h2>
      {isCurrent && subscription ? (
        <p className="mt-2 text-base text-muted">
          {statusLabel[subscription.status]}
          {subscription.current_period_end &&
            ` · renews ${new Date(subscription.current_period_end).toLocaleDateString()}`}
        </p>
      ) : (
        <>
          <p className="mt-2 text-base text-muted">
            {subscription
              ? 'This parent’s subscription has lapsed, so talk access is paused.'
              : 'This parent doesn’t have an active trial or subscription yet, so talk access is paused.'}
          </p>
          {error && <p className="mt-2 text-base text-clay">{error}</p>}
          <button type="button" onClick={startTrial} disabled={busy} className="btn-primary mt-4 disabled:opacity-60">
            {busy ? 'Redirecting…' : 'Start 7-day free trial'}
          </button>
        </>
      )}
    </section>
  );
}

function ProfileForm({ parent, onSaved }: { parent: Parent; onSaved: (p: Parent) => void }) {
  const [pronouns, setPronouns] = useState(parent.pronouns ?? '');
  const [city, setCity] = useState(parent.city ?? '');
  const [language, setLanguage] = useState(parent.language);
  const [largeText, setLargeText] = useState(parent.large_text);
  const [voiceFirst, setVoiceFirst] = useState(parent.voice_first);
  const [speechRate, setSpeechRate] = useState<'slow' | 'normal'>(parent.speech_rate);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  // Include the parent's current language even if it's not in the preset list,
  // so saving never silently changes it.
  const languages = LANGUAGES.some((l) => l.code === parent.language)
    ? LANGUAGES
    : [{ code: parent.language, label: parent.language }, ...LANGUAGES];

  async function save() {
    setStatus('');
    setBusy(true);
    try {
      const r = await api.patch<{ parent: Parent }>(`/api/parents/${parent.id}`, {
        pronouns: pronouns.trim(),
        city: city.trim(),
        language,
        large_text: largeText,
        voice_first: voiceFirst,
        speech_rate: speechRate,
      });
      onSaved(r.parent);
      // Re-seed the inputs from the persisted record so the form reflects the
      // server-normalized values (e.g. trimmed text) rather than the raw typed
      // text — the panel's key doesn't change on save, so useState won't re-init.
      setPronouns(r.parent.pronouns ?? '');
      setCity(r.parent.city ?? '');
      setLanguage(r.parent.language);
      setLargeText(r.parent.large_text);
      setVoiceFirst(r.parent.voice_first);
      setSpeechRate(r.parent.speech_rate);
      setStatus('Saved.');
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line bg-cloud p-6">
        <h2 className="text-lg font-semibold text-ink">{parent.first_name}</h2>
        <p className="mt-1 text-base text-muted">
          {parent.relationship}
          {parent.activated_at ? ' · active' : ' · not yet active'}
        </p>
      </div>

      <section className="space-y-5 rounded-xl border border-line bg-cloud p-6">
        <div>
          <label htmlFor="pp-pronouns" className="block text-base font-semibold text-ink">
            Pronouns
          </label>
          <input
            id="pp-pronouns"
            value={pronouns}
            onChange={(e) => setPronouns(e.target.value)}
            placeholder="she/her, he/him…"
            className={fieldCls}
          />
        </div>

        <div>
          <label htmlFor="pp-city" className="block text-base font-semibold text-ink">
            City
          </label>
          <input
            id="pp-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Where they live"
            className={fieldCls}
          />
        </div>

        <div>
          <label htmlFor="pp-language" className="block text-base font-semibold text-ink">
            Language
          </label>
          <select
            id="pp-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={fieldCls}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pp-speech" className="block text-base font-semibold text-ink">
            Speech pace
          </label>
          <select
            id="pp-speech"
            value={speechRate}
            onChange={(e) => setSpeechRate(e.target.value as 'slow' | 'normal')}
            className={fieldCls}
          >
            <option value="slow">Slow &amp; clear</option>
            <option value="normal">Normal</option>
          </select>
        </div>

        <label className="flex items-center gap-3 text-base text-ink">
          <input
            type="checkbox"
            checked={largeText}
            onChange={(e) => setLargeText(e.target.checked)}
            className="h-5 w-5 rounded border-line text-sage focus:ring-sage"
          />
          Larger text on their screen
        </label>

        <label className="flex items-center gap-3 text-base text-ink">
          <input
            type="checkbox"
            checked={voiceFirst}
            onChange={(e) => setVoiceFirst(e.target.checked)}
            className="h-5 w-5 rounded border-line text-sage focus:ring-sage"
          />
          Voice-first (speak rather than type)
        </label>

        <div className="flex items-center gap-4 pt-2">
          <button type="button" onClick={save} disabled={busy} className="btn-primary disabled:opacity-60">
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {status && <p className="text-sm text-muted">{status}</p>}
        </div>
      </section>
    </div>
  );
}
