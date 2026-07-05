import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { consentRepo } from '@/lib/repos/consent';

type Ctx = { params: { id: string } };

/**
 * List a parent's summary recipients (pending + accepted). Only a safe view is
 * returned — the consent `detail` also holds `invite_token_hash`, which must
 * never reach the client, so we map to { id, email, status } explicitly.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const consents = await consentRepo.list(pool, params.id, 'summary_recipient');
    const recipients = consents.map((c) => {
      const detail = (c.detail ?? {}) as { recipient_email?: string; status?: string };
      return {
        id: c.id,
        email: detail.recipient_email ?? '',
        // Legacy consents recorded without a status count as accepted (they
        // predate the pending/accepted flow); only explicit 'pending' is pending.
        status: detail.status === 'pending' ? 'pending' : 'accepted',
      };
    });
    return NextResponse.json({ recipients });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
