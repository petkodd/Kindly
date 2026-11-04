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
import { ConversationFullError, PayloadTooLargeError, RateLimitError, ValidationError } from '@/lib/types';
import { crisisShortcut } from '@/lib/talk/crisisShortcut';
import { getSpeechClient } from '@/lib/speech';

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
    // Spend guard: per-parent and per-IP turn limits (429 with a speakable
    // message). A refusal is held, not returned yet: crisis words must get
    // help even when the turn is refused (release check NEW-2).
    let refusal: unknown = null;
    try {
      await enforceTalkRate(pool, parentId, clientIp(req));
    } catch (err) {
      if (!(err instanceof RateLimitError)) throw err;
      refusal = err;
    }

    const body = await readJsonBody(req);
    const conversationId = body.conversation_id as string;
    if (!conversationId) throw new ValidationError('conversation_id is required');
    const content = ((body.content as string) ?? '').trim();
    if (!content) throw new ValidationError('message content is required');

    if (!refusal) {
      try {
        enforceTextCap(content);
        // Gate before doing any model work: ownership + still-open + turn cap.
        await conversationRepo.requireOpen(pool, conversationId, parentId);
        await enforceTurnCap(pool, conversationId, parentId);
      } catch (err) {
        if (!(err instanceof PayloadTooLargeError || err instanceof ConversationFullError)) throw err;
        refusal = err;
      }
    }

    if (refusal) {
      const crisis = await crisisShortcut(pool, { parentId, conversationId, text: content });
      if (!crisis) throw refusal;
      return NextResponse.json({
        conversation_id: conversationId,
        reply: crisis.reply,
        crisis: crisis.severity,
        tts_url: await speakBestEffort(crisis.reply, parentId),
      });
    }
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

/** Speak the crisis copy if the speech provider can; the text is always shown. */
async function speakBestEffort(text: string, parentId: string): Promise<string | null> {
  try {
    const parent = await parentRepo.getById(db(), parentId);
    const { audioUrl } = await getSpeechClient().textToSpeech(text, { speechRate: parent.speech_rate });
    return audioUrl;
  } catch (err) {
    console.error('crisis copy TTS failed', (err as Error)?.name);
    return null;
  }
}
