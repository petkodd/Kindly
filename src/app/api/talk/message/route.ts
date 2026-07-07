import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, readJsonBody, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { conversationRepo } from '@/lib/repos/conversation';
import { memoryRepo } from '@/lib/repos/memory';
import { getAiClient } from '@/lib/ai';
import type { ConversationTurn, RetrievedMemory, SafetyScan } from '@/lib/ai';
import { crisisResourceV1 } from '@/lib/ai/prompts';
import { safetyFlagRepo } from '@/lib/repos/safetyFlag';
import { ValidationError } from '@/lib/types';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Valid access token required.' } }, { status: 401 });

/**
 * Process a parent turn: assemble the companion context (profile + confirmed
 * non-restricted memories + rolling history), run the safety pre-scan and the
 * companion reply, then record BOTH turns. Turns are written only after a
 * successful reply, so a model failure never leaves an orphaned parent turn (and
 * a client retry can't duplicate it).
 *
 * Safety: the scan runs in parallel with the reply. A flagged turn (P0–P3)
 * writes a minimized safety_flag for human review; P0/P1 additionally prepend
 * deterministic crisis resources (988/911) to the reply so they always surface.
 * If the scan itself errors, we fail SAFE — route it to human review as P2
 * rather than silently clearing — without blocking the reply.
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

    const ai = getAiClient();
    // Scan and reply run concurrently, but the flag is persisted from the scan
    // BEFORE we await the reply — safety detection must not depend on the reply
    // succeeding. A scan failure fails SAFE (route to human review as P2); a
    // reply failure rejects → 502, with the flag already recorded.
    const scanPromise = ai
      .safetyScan({ message: content })
      .catch(
        (): SafetyScan => ({ severity: 'p2', rationale: 'safety scan unavailable — manual review' }),
      );
    const replyPromise = ai.companionReply({
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

    // A flagged turn is recorded for human review (minimized detail — rationale,
    // never the raw message). Recorded first so a reply failure can't lose it.
    const scan = await scanPromise;
    if (scan.severity !== 'none') {
      await safetyFlagRepo.record(pool, {
        parentId,
        conversationId,
        severity: scan.severity,
        detail: scan.rationale,
      });
    }

    const reply = await replyPromise;

    // P0/P1 always surface crisis resources, regardless of what the model wrote.
    const replyText =
      scan.severity === 'p0' || scan.severity === 'p1'
        ? `${crisisResourceV1(scan.severity)}\n\n${reply.text}`
        : reply.text;

    // Persist the exchange only now that we have a reply.
    await conversationRepo.addTurn(pool, conversationId, parentId, 'parent', content);
    await conversationRepo.addTurn(pool, conversationId, parentId, 'kindly', replyText);

    return NextResponse.json({ conversation_id: conversationId, reply: replyText });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
