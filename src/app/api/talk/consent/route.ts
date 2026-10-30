import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, errorToResponse } from '@/lib/auth';
import { consentRepo } from '@/lib/repos/consent';
import { PARENT_CONVERSATION_NOTICE } from '@/lib/talk/notices';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Valid access token required.' } }, { status: 401 });

/**
 * Record the parent_conversation consent (first-session gate) with the exact
 * intro text and version the talk screen shows (PARENT_CONVERSATION_NOTICE —
 * the page renders the same constant).
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const parentId = await resolveParentFromRequest(req, pool);
    if (!parentId) return unauthorized();
    // Idempotent: recording twice returns the existing consent, not a duplicate.
    const consent = await consentRepo.ensure(pool, {
      parentId,
      kind: 'parent_conversation',
      detail: {
        notice_text: PARENT_CONVERSATION_NOTICE.text,
        notice_version: PARENT_CONVERSATION_NOTICE.version,
        channel: 'talk_screen',
      },
    });
    return NextResponse.json({ consent }, { status: 201 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
