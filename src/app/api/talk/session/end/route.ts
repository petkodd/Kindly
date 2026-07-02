import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, errorToResponse } from '@/lib/auth';
import { conversationRepo } from '@/lib/repos/conversation';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Valid access token required.' } }, { status: 401 });

/**
 * End a session. The summarize + memory-extraction jobs are triggered from the
 * session-end slice; here we just close the conversation (idempotent).
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const parentId = await resolveParentFromRequest(req, pool);
    if (!parentId) return unauthorized();

    const body = await req.json();
    const conversation = await conversationRepo.end(pool, body.conversation_id, parentId);
    return NextResponse.json({ conversation_id: conversation.id, ended_at: conversation.ended_at });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
