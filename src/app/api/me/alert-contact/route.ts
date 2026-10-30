import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, readJsonBody, errorToResponse } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { NotFoundError, ValidationError } from '@/lib/types';
import { toUsE164 } from '@/lib/phone';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });

function view(contact: { alertPhone: string | null; smsAlertConsentAt: string | null }) {
  return { alert_phone: contact.alertPhone, sms_alert_consent_at: contact.smsAlertConsentAt };
}

/** The buyer's emergency-alert phone and SMS consent (decision D2). */
export async function GET(req: NextRequest) {
  const userId = await resolveBuyer(req);
  if (!userId) return unauthorized();
  try {
    const contact = await userRepo.getAlertContact(db(), userId);
    if (!contact) throw new NotFoundError('Account not found');
    return NextResponse.json({ alert_contact: view(contact) });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * Set or clear the emergency-alert phone (onboarding's "Emergency alerts"
 * step and the account page). Body: `{ phone: "+15551234567" | null,
 * sms_consent: boolean }`. A phone must be a US number in E.164 (+1 and ten
 * digits). SMS alerts need the explicit, unticked-by-default consent box;
 * without it (or with no phone) alerts go by email only.
 */
export async function PUT(req: NextRequest) {
  const userId = await resolveBuyer(req);
  if (!userId) return unauthorized();
  try {
    const body = await readJsonBody(req);
    const rawPhone = body.phone;
    if (rawPhone !== null && rawPhone !== undefined && typeof rawPhone !== 'string') {
      throw new ValidationError('phone must be a string or null');
    }
    if (typeof body.sms_consent !== 'boolean') throw new ValidationError('sms_consent must be true or false');
    const phone = normalizeUsPhone(rawPhone ?? null);
    const contact = await userRepo.setAlertPhone(db(), userId, { phone, smsConsent: body.sms_consent });
    return NextResponse.json({ alert_contact: view(contact) });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** '' / null → null; otherwise must be a US mobile number, returned as E.164 (+1XXXXXXXXXX). */
function normalizeUsPhone(raw: string | null): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const e164 = toUsE164(trimmed);
  if (!e164) throw new ValidationError('Please enter a US mobile number, like (312) 555-0142.');
  return e164;
}
