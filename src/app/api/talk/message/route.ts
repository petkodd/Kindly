import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, readJsonBody, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { conversationRepo } from '@/lib/repos/conversation';
import { memoryRepo } from '@/lib/repos/memory';
import { getAiClient } from '@/lib/ai';
import type { ConversationTurn, RetrievedMemory } from '@/lib/ai';
import { ValidationError } from '@/lib/types';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Valid access token required.' } }, { status: 401 });

/**
 * Process a parent turn: assemble the companion context (profile + confirmed
 * non-restricted memories + rolling history), get the reply, then record BOTH
 * turns. Turns are written only after a successful reply, so a model failure
 * never leaves an orphaned parent turn (and a client retry can't duplicate it).
 *
 * NOTE: the per-message safety scan (detect_safety_flags → safety_flags + alert
 * routing) lands in the safety-escalation slice; the hook is intentionally not
 * wired here to avoid a half-integrated safety path.
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
    ).map((m) => ({ layer: m.layer, key: m.mem_key, value: m.mem_value }));

    const reply = await getAiClient().companionReply({
      profile: {
        firstName: parent.first_name,
        pronouns: parent.pronouns,
        city: parent.city,
        speechRate: parent.speech_rate,
      },
      memories,
      history,
      message: content,
      isSessionOpen: false,
    });

    // Persist the exchange only now that we have a reply.
    await conversationRepo.addTurn(pool, conversationId, parentId, 'parent', content);
    await conversationRepo.addTurn(pool, conversationId, parentId, 'kindly', reply.text);

    return NextResponse.json({ conversation_id: conversationId, reply: reply.text });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
