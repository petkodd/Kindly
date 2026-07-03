import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBuyerId, readJsonBody, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { consentRepo } from '@/lib/repos/consent';

type Ctx = { params: { id: string } };

/**
 * Invite a sibling as a summary recipient. Creates a PENDING summary_recipient
 * consent and (mock) emails an accept link; the recipient must accept before any
 * summary is delivered to them.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const buyerId = getBuyerId(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const body = await readJsonBody(req);
    const { consent } = await consentRepo.recordRecipientInvite(pool, {
      parentId: params.id,
      grantedBy: buyerId,
      recipientEmail: body.email as string,
    });
    // The raw invite token is delivered ONLY to the recipient by email (mocked
    // in Alpha) — never returned to the buyer, or the buyer could self-accept
    // and defeat the recipient's consent.
    // TODO(email): send the accept link via the email provider.
    console.info('sibling invite created (pending acceptance)');
    return NextResponse.json({ consent_id: consent.id, status: 'pending' }, { status: 201 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
