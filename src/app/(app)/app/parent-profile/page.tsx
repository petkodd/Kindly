'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, grantSelfTalkAccess } from '@/lib/apiClient';
import { ParentPicker } from '@/components/ParentPicker';
import { EmptyParentState } from '@/components/EmptyParentState';
import { ParentGate } from '@/components/ParentGate';
import { checkCls, fieldErrorCls, helpCls, inputCls, labelCls } from '@/lib/formStyles';
import { PARENT_SHORT_FIELD_MAX, type Parent } from '@/lib/types';
import { validateProfile, type ProfileField } from '@/lib/profileValidation';
import { Card } from '@/components/Card';
import { FormStatus } from '@/components/FormStatus';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import Link from 'next/link';
import { ParentTalkLinkSection, TALK_LINK_SECTION_ID } from '@/components/ParentTalkLinkSection';


const LANGUAGES = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'es-US', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
];

// Labels sit above each field, so add top spacing to the shared in-card input.
const fieldCls = `mt-2 ${inputCls}`;

const RELATIONSHIP_LABELS: Record<string, string> = {
  self: 'You',
  mother: 'Mother',
  father: 'Father',
  grandparent: 'Grandparent',
  aunt: 'Aunt',
  uncle: 'Uncle',
  other: 'Family',
};

/** Display label for a parent's relationship — 'self' reads oddly verbatim. */
function relationshipLabel(relationship: string): string {
  return RELATIONSHIP_LABELS[relationship] ?? relationship;
}

export default function ParentProfilePage() {
  return (
    <ParentGate>
      {({ parents, selected, setSelected }) => (
        <div className="mx-auto max-w-2xl space-y-8">
          <div>
            <p className="eyebrow">Their profile</p>
            <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Parent profile</h1>
            <p className="mt-2 text-base text-muted">
              Tune how Dearly speaks with your parent — the accessibility settings that make each
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

  if (error) return <FormStatus kind="error" message={error} />;
  if (!parent) return <p className="text-base text-muted">Loading profile…</p>;

  return (
    <div className="space-y-6">
      <ProfileForm parent={parent} onSaved={setParent} />
      {parent.relationship === 'self' && parent.activated_at && <TalkToDearlySection parentId={parent.id} />}
      {parent.activated_at ? (
        <ParentTalkLinkSection parentId={parent.id} firstName={parent.first_name} />
      ) : (
        <Card id={TALK_LINK_SECTION_ID}>
          <h2 className="text-lg font-semibold text-ink">{parent.first_name}&rsquo;s talk link</h2>
          <p className="mt-2 text-base text-muted">
            Finish setting up {parent.first_name}&rsquo;s profile first, then you can make their talk link here.
          </p>
          <Link href="/app/onboarding" className="btn-primary mt-4">
            Finish setup
          </Link>
        </Card>
      )}
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
function TalkToDearlySection({ parentId }: { parentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function startTalking() {
    setError('');
    setBusy(true);
    try {
      await grantSelfTalkAccess(parentId);
      router.push('/app/talk');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start talking. Please try again.');
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">Talk to Dearly</h2>
      <FormStatus kind="error" message={error} className="mt-2" />
      <button type="button" onClick={startTalking} disabled={busy} className="btn-primary mt-4 disabled:opacity-60">
        {busy ? 'One moment…' : 'Start talking'}
      </button>
    </Card>
  );
}

interface SubscriptionInfo {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'beta';
  current_period_end: string | null;
  billing_interval: 'month' | 'year' | null;
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
      // A returning subscriber keeps the interval they were already on
      // (recovering from a lapsed subscription shouldn't silently switch
      // someone from monthly to a bigger annual charge); a parent who never
      // subscribed at all has no prior interval to preserve, so defaults to
      // annual, matching pricing/onboarding. Not one of the two toggle
      // surfaces named in the task's acceptance criteria, so no visible
      // toggle here — just a safer default.
      const { url, already_subscribed: alreadySubscribed } = await api.post<{ url: string | null; already_subscribed?: boolean }>(
        '/api/billing/checkout',
        { parent_id: parentId, interval: subscription?.billing_interval ?? 'year' },
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
    beta: 'Founding Family Beta',
  };
  const wasBeta = subscription?.status === 'beta';

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">Billing</h2>
      {isCurrent && subscription ? (
        <p className="mt-2 text-base text-muted">
          {statusLabel[subscription.status]}
          {subscription.current_period_end &&
            ` · ${subscription.status === 'beta' ? 'ends' : 'renews'} ${new Date(subscription.current_period_end).toLocaleDateString()}`}
        </p>
      ) : (
        <>
          <p className="mt-2 text-base text-muted">
            {wasBeta ? (
              <>
                Your Founding Family Beta has ended. Your family will not be charged
                automatically — choose a plan when you’re ready to continue.
              </>
            ) : subscription ? (
              'This parent’s subscription has lapsed, so talk access is paused.'
            ) : (
              'This parent doesn’t have an active trial or subscription yet, so talk access is paused.'
            )}
          </p>
          <FormStatus kind="error" message={error} className="mt-2" />
          <button type="button" onClick={startTrial} disabled={busy} className="btn-primary mt-4 disabled:opacity-60">
            {busy ? 'Redirecting…' : 'Start 7-day free trial'}
          </button>
        </>
      )}
    </Card>
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
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState<Partial<Record<ProfileField, boolean>>>({});

  const fieldErrors = validateProfile({ pronouns, city });
  const dirty =
    pronouns !== (parent.pronouns ?? '') ||
    city !== (parent.city ?? '') ||
    language !== parent.language ||
    largeText !== parent.large_text ||
    voiceFirst !== parent.voice_first ||
    speechRate !== parent.speech_rate;
  useUnsavedChangesWarning(dirty);

  // Include the parent's current language even if it's not in the preset list,
  // so saving never silently changes it.
  const languages = LANGUAGES.some((l) => l.code === parent.language)
    ? LANGUAGES
    : [{ code: parent.language, label: parent.language }, ...LANGUAGES];

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setSuccess('');
    setError('');
    setTouched({ pronouns: true, city: true });
    if (Object.keys(fieldErrors).length > 0) {
      setError('Please fix the highlighted fields.');
      return;
    }
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
      setSuccess('Saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  function textField(field: ProfileField, label: string, value: string, set: (v: string) => void, placeholder: string) {
    const id = `pp-${field}`;
    const showError = touched[field] ? fieldErrors[field] : undefined;
    return (
      <div>
        <label htmlFor={id} className={labelCls}>
          {label}
        </label>
        <input
          id={id}
          value={value}
          maxLength={PARENT_SHORT_FIELD_MAX}
          onChange={(e) => {
            set(e.target.value);
            setSuccess('');
          }}
          onBlur={() => setTouched((t) => ({ ...t, [field]: true }))}
          placeholder={placeholder}
          aria-invalid={showError ? true : undefined}
          aria-describedby={`${id}-help${showError ? ` ${id}-error` : ''}`}
          className={fieldCls}
        />
        <p id={`${id}-help`} className={helpCls}>
          Optional · {value.length}/{PARENT_SHORT_FIELD_MAX} characters
        </p>
        {showError && (
          <p id={`${id}-error`} className={fieldErrorCls}>
            {showError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card as="div">
        <h2 className="text-lg font-semibold text-ink">{parent.first_name}</h2>
        <p className="mt-1 text-base text-muted">
          {relationshipLabel(parent.relationship)}
          {parent.activated_at ? ' · active' : ' · not yet active'}
        </p>
      </Card>

      <Card as="form" onSubmit={save} noValidate aria-label="Profile settings" className="space-y-5">
        {textField('pronouns', 'Pronouns', pronouns, setPronouns, 'she/her, he/him…')}
        {textField('city', 'City', city, setCity, 'Where they live')}

        <div>
          <label htmlFor="pp-language" className={labelCls}>
            Language
          </label>
          <select
            id="pp-language"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              setSuccess('');
            }}
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
          <label htmlFor="pp-speech" className={labelCls}>
            Speech pace
          </label>
          <select
            id="pp-speech"
            value={speechRate}
            onChange={(e) => {
              setSpeechRate(e.target.value as 'slow' | 'normal');
              setSuccess('');
            }}
            className={fieldCls}
          >
            <option value="slow">Slow &amp; clear</option>
            <option value="normal">Normal</option>
          </select>
        </div>

        <label className="flex min-h-[2.75rem] items-center gap-3 text-base text-ink">
          <input
            type="checkbox"
            checked={largeText}
            onChange={(e) => {
              setLargeText(e.target.checked);
              setSuccess('');
            }}
            className={checkCls}
          />
          Larger text on their screen
        </label>

        <label className="flex min-h-[2.75rem] items-center gap-3 text-base text-ink">
          <input
            type="checkbox"
            checked={voiceFirst}
            onChange={(e) => {
              setVoiceFirst(e.target.checked);
              setSuccess('');
            }}
            className={checkCls}
          />
          Voice-first (speak rather than type)
        </label>

        <div className="space-y-3 pt-2">
          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" disabled={busy} className="btn-primary disabled:opacity-60">
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            {dirty && !busy && <p className="text-base text-muted">You have unsaved changes.</p>}
          </div>
          <FormStatus kind="error" message={error} />
          <FormStatus kind="success" message={success} />
        </div>
      </Card>
    </div>
  );
}
