import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { conversationRepo } from '@/lib/repos/conversation';
import { memoryRepo } from '@/lib/repos/memory';
import { usageCostRepo } from '@/lib/repos/usageCost';
import type { ConversationTurn, RetrievedMemory } from '@/lib/ai';
import { runCompanionTurn } from '@/lib/ai/turn';
import { getSpeechClient } from '@/lib/speech';
import { ValidationError } from '@/lib/types';

const unauthorized = () =>
  NextResponse.json(
    { error: { code: 'unauthorized', message: 'Valid access token required.' } },
    { status: 401 },
  );

/**
 * POST /api/talk/voice
 * Body: multipart/form-data — `audio` (Blob) + `conversation_id` (string).
 * Pipeline: STT → runCompanionTurn (safety scan + reply, banned-output filter,
 * crisis prefix, alerting — the same pipeline as the text turn) → TTS →
 * persist turns → log voice_minutes → record usage_costs (auxiliary —
 * swallowed on failure, see the try/catch around it below).
 *
 * <2.5s perceived start is a performance target for streaming TTS (follow-up).
 * Alpha returns the full audio as a data URL once the pipeline completes.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const parentId = await resolveParentFromRequest(req, pool);
    if (!parentId) return unauthorized();

    // --- parse multipart ---
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw new ValidationError('Request must be multipart/form-data.');
    }
    const conversationId = (formData.get('conversation_id') as string | null)?.trim();
    if (!conversationId) throw new ValidationError('conversation_id is required');
    const audioEntry = formData.get('audio');
    if (!(audioEntry instanceof Blob)) throw new ValidationError('audio file is required');

    const mimeType = audioEntry.type || 'audio/webm';
    const audioBuffer = Buffer.from(await audioEntry.arrayBuffer());

    // Ownership + open check before doing any provider work.
    await conversationRepo.requireOpen(pool, conversationId, parentId);
    const parent = await parentRepo.getById(pool, parentId);

    // --- STT ---
    const speech = getSpeechClient();
    const { transcript, durationSeconds } = await speech.speechToText(audioBuffer, mimeType);
    if (!transcript) {
      return NextResponse.json(
        { error: { code: 'no_transcript', message: 'Could not transcribe audio.' } },
        { status: 422 },
      );
    }

    const history: ConversationTurn[] = (
      await conversationRepo.listTurns(pool, conversationId)
    ).map((t) => ({ role: t.role, content: t.content }));

    const memories: RetrievedMemory[] = (
      await memoryRepo.retrieveForCompanion(pool, parentId)
    ).map((m) => ({ layer: m.layer, key: m.mem_key, value: m.mem_value }));

    // Same pipeline as the text turn: scan → reply → banned-output filter →
    // crisis prefix, plus D2 alerting.
    const { replyText } = await runCompanionTurn(pool, {
      parent,
      conversationId,
      message: transcript,
      history,
      memories,
      channel: 'voice',
    });

    // --- TTS runs before persisting, mirroring the text-turn invariant: turns
    // are written only after the full pipeline succeeds, so a TTS failure never
    // leaves the client unsure whether the turn "took" (which would risk a retry
    // re-submitting the same audio and duplicating the exchange).
    const { audioUrl } = await speech.textToSpeech(replyText, {
      speechRate: parent.speech_rate,
    });

    // Persist the exchange now that we have a reply AND synthesized audio.
    const parentTurn = await conversationRepo.addTurn(pool, conversationId, parentId, 'parent', transcript);
    const kindlyTurn = await conversationRepo.addTurn(pool, conversationId, parentId, 'kindly', replyText);
    await conversationRepo.addVoiceMinutes(pool, conversationId, parentId, durationSeconds);

    // Cost accounting is auxiliary to the product experience: the transcript,
    // reply, and audio are already correct and persisted above, so a failure
    // writing usage_costs is caught/logged rather than failing this request.
    try {
      await Promise.all([
        usageCostRepo.recordSttCost(pool, { turnId: parentTurn.id, conversationId, parentId, durationSeconds }),
        usageCostRepo.recordTtsCost(pool, {
          turnId: kindlyTurn.id,
          conversationId,
          parentId,
          characterCount: replyText.length,
        }),
      ]);
    } catch (err) {
      console.error('usage cost write failed', conversationId, err);
    }

    return NextResponse.json({
      conversation_id: conversationId,
      transcript,
      reply: replyText,
      tts_url: audioUrl,
    });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
