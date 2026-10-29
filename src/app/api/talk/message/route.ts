import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, readJsonBody, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { conversationRepo } from '@/lib/repos/conversation';
import { memoryRepo } from '@/lib/repos/memory';
import type { ConversationTurn, RetrievedMemory } from '@/lib/ai';
import { runCompanionTurn } from '@/lib/ai/turn';
import { ValidationError } from '@/lib/types';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Valid access token required.' } }, { status: 401 });

/**
 * Process a typed parent turn: assemble the companion context (profile +
 * confirmed non-restricted memories + rolling history), run it through the
 * shared safety pipeline (runCompanionTurn: scan, reply, banned-output filter,
 * crisis prefix, alerting), then record BOTH turns. Turns are written only
 * after a successful reply, so a model failure never leaves an orphaned parent
 * turn (and a client retry can't duplicate it). The voice route uses the same
 * pipeline.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const parentId = await resolveParentFromRequest(req, pool);
    if (!parentId) return unauthorized();

    const body = await readJsonBody(req);
    const conversationId = body.conversation_id as string;
    if (!conversationId) throw new ValidationError('conversation_id is required');
    const content = ((body.content as string) ?? '').trim();
    if (!content) throw new ValidationError('message content is required');

    // Gate before doing any model work: ownership + still-open.
    await conversationRepo.requireOpen(pool, conversationId, parentId);
    const parent = await parentRepo.getById(pool, parentId);

    const history: ConversationTurn[] = (
      await conversationRepo.listTurns(pool, conversationId)
    ).map((t) => ({ role: t.role, content: t.content }));

    const memories: RetrievedMemory[] = (
      await memoryRepo.retrieveForCompanion(pool, parentId)
    ).map((m) => ({ layer: m.layer, key: m.mem_key, value: m.mem_value, sensitivity: m.sensitivity }));

    // Scan → reply → banned-output filter → crisis prefix, plus D2 alerting.
    const { replyText } = await runCompanionTurn(pool, {
      parent,
      conversationId,
      message: content,
      history,
      memories,
      channel: 'text',
    });

    // Persist the exchange only now that we have a reply.
    await conversationRepo.addTurn(pool, conversationId, parentId, 'parent', content);
    await conversationRepo.addTurn(pool, conversationId, parentId, 'kindly', replyText);

    return NextResponse.json({ conversation_id: conversationId, reply: replyText });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
