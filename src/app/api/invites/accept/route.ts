import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse } from '@/lib/auth';
import { consentRepo } from '@/lib/repos/consent';
import { ValidationError } from '@/lib/types';

/**
 * Accept a summary-recipient invite (public — the sibling clicks an emailed
 * link). Activates the pending consent so the recipient can receive summaries.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const body = await readJsonBody(req);
    const token = body.token as string;
    if (!token) throw new ValidationError('token is required');
    await consentRepo.acceptRecipientInvite(pool, token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
