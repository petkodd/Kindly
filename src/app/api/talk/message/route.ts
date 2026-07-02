import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { conversationRepo } from '@/lib/repos/conversation';
import { memoryRepo } from '@/lib/repos/memory';
import { getAiClient } from '@/lib/ai';
import type { ConversationTurn, RetrievedMemory } from '@/lib/ai';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Valid access token required.' } }, { status: 401 });

/**
 * Process a parent turn: record it, assemble the companion context (profile +
 * confirmed non-restricted memories + rolling history), get the reply, record it.
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

    const body = await req.json();
    const conversationId: string = body.conversation_id;
    const content: string = body.content;

    const parent = await parentRepo.getById(pool, parentId);
    // Records the parent turn and enforces ownership + not-ended in one place.
    await conversationRepo.addTurn(pool, conversationId, parentId, 'parent', content);

    const allTurns = await conversationRepo.listTurns(pool, conversationId);
    const history: ConversationTurn[] = allTurns
      .slice(0, -1) // everything before the message we just added
      .map((t) => ({ role: t.role, content: t.content }));

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

    await conversationRepo.addTurn(pool, conversationId, parentId, 'kindly', reply.text);

    return NextResponse.json({ conversation_id: conversationId, reply: reply.text });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
