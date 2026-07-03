import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { conversationRepo } from '@/lib/repos/conversation';
import { companionGreetingV1 } from '@/lib/ai/prompts';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Valid access token required.' } }, { status: 401 });

/**
 * Open a conversation. 403 (ForbiddenError) if no parent_conversation consent.
 * Returns a greeting that discloses Kindly is an AI, stored as the first turn.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const parentId = await resolveParentFromRequest(req, pool);
    if (!parentId) return unauthorized();

    const parent = await parentRepo.getById(pool, parentId);
    const conversation = await conversationRepo.openSession(pool, parentId, 'text');
    const greeting = companionGreetingV1(parent.first_name);
    await conversationRepo.addTurn(pool, conversation.id, parentId, 'kindly', greeting);

    return NextResponse.json({ conversation_id: conversation.id, greeting }, { status: 201 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
