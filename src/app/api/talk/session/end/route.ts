import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, readJsonBody, errorToResponse } from '@/lib/auth';
import { conversationRepo } from '@/lib/repos/conversation';
import { ValidationError } from '@/lib/types';

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

    const body = await readJsonBody(req);
    const conversationId = body.conversation_id as string;
    if (!conversationId) throw new ValidationError('conversation_id is required');
    const conversation = await conversationRepo.end(pool, conversationId, parentId);
    return NextResponse.json({ conversation_id: conversation.id, ended_at: conversation.ended_at });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
