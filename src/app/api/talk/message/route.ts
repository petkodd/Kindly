import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, readJsonBody, errorToResponse, clientIp } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { conversationRepo } from '@/lib/repos/conversation';
import { memoryRepo } from '@/lib/repos/memory';
import type { ConversationTurn, RetrievedMemory } from '@/lib/ai';
import { runCompanionTurn } from '@/lib/ai/turn';
import { HISTORY_MAX_TURNS, trimHistory } from '@/lib/ai/history';
import { usageCostRepo } from '@/lib/repos/usageCost';
import { enforceTalkRate, enforceTextCap, enforceTurnCap } from '@/lib/talk/limits';
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
    // Spend guard: per-parent and per-IP turn limits (429 with a speakable message).
    await enforceTalkRate(pool, parentId, clientIp(req));

    const body = await readJsonBody(req);
    const conversationId = body.conversation_id as string;
    if (!conversationId) throw new ValidationError('conversation_id is required');
    const content = ((body.content as string) ?? '').trim();
    if (!content) throw new ValidationError('message content is required');
    enforceTextCap(content);

    // Gate before doing any model work: ownership + still-open + turn cap.
    await conversationRepo.requireOpen(pool, conversationId, parentId);
    await enforceTurnCap(pool, conversationId, parentId);
    const parent = await parentRepo.getById(pool, parentId);

    // Only the recent window goes to the model, so cost per turn stays flat.
    const history: ConversationTurn[] = trimHistory(
      (await conversationRepo.listRecentTurns(pool, conversationId, HISTORY_MAX_TURNS)).map((t) => ({
        role: t.role,
        content: t.content,
      })),
    );

    const memories: RetrievedMemory[] = (
      await memoryRepo.retrieveForCompanion(pool, parentId)
    ).map((m) => ({ layer: m.layer, key: m.mem_key, value: m.mem_value, sensitivity: m.sensitivity }));

    // Scan → reply → banned-output filter → crisis prefix, plus D2 alerting.
    const { replyText, usages } = await runCompanionTurn(pool, {
      parent,
      conversationId,
      message: content,
      history,
      memories,
      channel: 'text',
    });

    // Persist the exchange only now that we have a reply.
    await conversationRepo.addTurn(pool, conversationId, parentId, 'parent', content);
    const kindlyTurn = await conversationRepo.addTurn(pool, conversationId, parentId, 'kindly', replyText);
    // LLM cost ledger (best-effort; never fails the turn).
    await usageCostRepo.recordLlmUsages(pool, { turnId: kindlyTurn.id, conversationId, parentId, usages });

    return NextResponse.json({ conversation_id: conversationId, reply: replyText });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
