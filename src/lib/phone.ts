/**
 * US phone helpers for the emergency-alert number (decision D2: alerts go to
 * the gift buyer by SMS in the US). Shared by the onboarding/account forms and
 * the /api/me/alert-contact route so both accept exactly the same input.
 */

/**
 * Accepts "(555) 234-5678", "555.234.5678", "5552345678", "1 555 234 5678",
 * "+1 555 234 5678" and returns E.164 ("+15552345678"), or null when it isn't
 * a valid NANP number (10 digits; area code and exchange can't start with 0/1).
 */
export function toUsE164(input: string): string | null {
  const trimmed = input.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  if (trimmed.startsWith('+') && !trimmed.startsWith('+1')) return null; // US numbers only
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

/** "+15552345678" → "(555) 234-5678" for display; anything else is returned unchanged. */
export function formatUsPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/**
 * The SMS consent wording shown next to the (unticked) checkbox. One source
 * so onboarding and the account page always show the same text.
 */
export const SMS_CONSENT_TEXT =
  'Yes, text me emergency alerts about my family member at this number. Messages are sent only when Dearly ' +
  'hears something that sounds like an emergency (usually none; at most about one every 30 minutes). ' +
  'Message and data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.';
