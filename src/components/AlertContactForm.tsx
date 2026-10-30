'use client';

import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '@/lib/apiClient';
import { formatUsPhone, SMS_CONSENT_TEXT, toUsE164 } from '@/lib/phone';
import { inputCls } from '@/lib/formStyles';

export interface AlertContact {
  alert_phone: string | null;
  sms_alert_consent_at: string | null;
}

/**
 * Emergency-alert phone + SMS consent (decision D2). Used by onboarding's
 * "Emergency alerts" step and the account page, so the wording and
 * validation are identical in both. The consent box always starts unticked
 * for a number that has no consent yet; consent is stored per number
 * (users.sms_alert_consent_at), and changing the number asks again.
 */
export function AlertContactForm({
  initial,
  saveLabel = 'Save',
  onSaved,
  onUnauthorized,
}: {
  initial: AlertContact | null;
  saveLabel?: string;
  onSaved?: (c: AlertContact) => void;
  onUnauthorized?: () => void;
}) {
  const ids = useId();
  const [phone, setPhone] = useState(formatUsPhone(initial?.alert_phone));
  const [consent, setConsent] = useState(!!initial?.sms_alert_consent_at);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  // The number the stored SMS consent belongs to (null when there is no consent).
  const [savedPhone, setSavedPhone] = useState<string | null>(
    initial?.sms_alert_consent_at ? (initial.alert_phone ?? null) : null,
  );

  useEffect(() => {
    setPhone(formatUsPhone(initial?.alert_phone));
    setConsent(!!initial?.sms_alert_consent_at);
    setSavedPhone(initial?.sms_alert_consent_at ? (initial.alert_phone ?? null) : null);
  }, [initial?.alert_phone, initial?.sms_alert_consent_at]);

  async function save() {
    setError('');
    setStatus('');
    const trimmed = phone.trim();
    const e164 = trimmed ? toUsE164(trimmed) : null;
    if (trimmed && !e164) return setError('Please enter a US mobile number, like (312) 555-0142.');
    if (!e164 && consent) return setError('Add your mobile number to get text alerts, or untick the box.');
    setBusy(true);
    try {
      const r = await api.put<{ alert_contact: AlertContact }>('/api/me/alert-contact', {
        phone: e164,
        sms_consent: !!e164 && consent,
      });
      setPhone(formatUsPhone(r.alert_contact.alert_phone));
      setConsent(!!r.alert_contact.sms_alert_consent_at);
      setSavedPhone(r.alert_contact.sms_alert_consent_at ? r.alert_contact.alert_phone : null);
      setStatus(
        r.alert_contact.sms_alert_consent_at
          ? 'Saved. Emergency alerts will come by text and email.'
          : 'Saved. Emergency alerts will come by email only.',
      );
      onSaved?.(r.alert_contact);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && onUnauthorized) return onUnauthorized();
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${ids}-phone`} className="block text-base font-semibold text-ink">
          Your mobile number (US)
        </label>
        <input
          id={`${ids}-phone`}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={phone}
          onChange={(e) => {
            const value = e.target.value;
            setPhone(value);
            // Consent is per number: once the buyer types a different number than
            // the one they agreed for, untick the box so they must agree again
            // (otherwise the old tick would silently grant consent for the new one).
            // A half-typed number can't be saved anyway, so only a complete different
            // number (or an empty field) clears it.
            const typed = value.trim();
            if (savedPhone && (!typed || (toUsE164(typed) ?? savedPhone) !== savedPhone)) setConsent(false);
          }}
          placeholder="(312) 555-0142"
          aria-describedby={`${ids}-phone-hint`}
          className={`mt-2 ${inputCls}`}
        />
        <p id={`${ids}-phone-hint`} className="mt-1 text-sm text-muted">
          US numbers only for now. Leave it empty to get alerts by email only.
        </p>
      </div>
      <label className="flex items-start gap-3 rounded-xl border border-line bg-mist p-4 text-base text-ink">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 h-6 w-6 shrink-0 rounded border-line"
        />
        <span>{SMS_CONSENT_TEXT}</span>
      </label>
      {error && (
        <p role="alert" className="text-base text-clay">
          {error}
        </p>
      )}
      <button type="button" onClick={save} disabled={busy} className="btn-primary w-full sm:w-auto disabled:opacity-60">
        {busy ? 'Saving…' : saveLabel}
      </button>
      {status && (
        <p role="status" className="text-base text-muted">
          {status}
        </p>
      )}
    </div>
  );
}
