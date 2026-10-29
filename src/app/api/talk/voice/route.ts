import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, errorToResponse, clientIp } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { conversationRepo } from '@/lib/repos/conversation';
import { memoryRepo } from '@/lib/repos/memory';
import { usageCostRepo } from '@/lib/repos/usageCost';
import type { ConversationTurn, RetrievedMemory } from '@/lib/ai';
import { runCompanionTurn } from '@/lib/ai/turn';
import { HISTORY_MAX_TURNS, trimHistory } from '@/lib/ai/history';
import {
  AUDIO_MAX_BYTES,
  enforceAudioCap,
  enforceTalkRate,
  enforceTurnCap,
  enforceVoiceMinutes,
} from '@/lib/talk/limits';
import { getSpeechClient } from '@/lib/speech';
import { ValidationError } from '@/lib/types';

// STT + model + TTS normally finish in a few seconds; never let one request run (and bill) for minutes.
export const maxDuration = 30;

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
    // Spend guards before any parsing or provider work.
    await enforceTalkRate(pool, parentId, clientIp(req));
    const declaredBytes = Number(req.headers.get('content-length') ?? 0);
    if (declaredBytes > AUDIO_MAX_BYTES + 64 * 1024) enforceAudioCap(declaredBytes);

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

    // Base type only ('audio/webm;codecs=opus' → 'audio/webm'): Safari records
    // MP4, other browsers WebM, and the speech provider sniffs the container.
    const mimeType = audioEntry.type.split(';')[0].trim() || 'audio/webm';
    enforceAudioCap(audioEntry.size);
    const audioBuffer = Buffer.from(await audioEntry.arrayBuffer());

    // Ownership + open check, turn cap and daily voice time before any provider work.
    await conversationRepo.requireOpen(pool, conversationId, parentId);
    await enforceTurnCap(pool, conversationId, parentId);
    await enforceVoiceMinutes(pool, parentId);
    const parent = await parentRepo.getById(pool, parentId);

    // --- STT ---
    const speech = getSpeechClient();
    const { transcript, durationSeconds } = await speech.speechToText(audioBuffer, mimeType, {
      language: parent.language,
    });
    if (!transcript) {
      return NextResponse.json(
        { error: { code: 'no_transcript', message: 'Could not transcribe audio.' } },
        { status: 422 },
      );
    }

    const history: ConversationTurn[] = trimHistory(
      (await conversationRepo.listRecentTurns(pool, conversationId, HISTORY_MAX_TURNS)).map((t) => ({
        role: t.role,
        content: t.content,
      })),
    );

    const memories: RetrievedMemory[] = (
      await memoryRepo.retrieveForCompanion(pool, parentId)
    ).map((m) => ({ layer: m.layer, key: m.mem_key, value: m.mem_value, sensitivity: m.sensitivity }));

    // Same pipeline as the text turn: scan → reply → banned-output filter →
    // crisis prefix, plus D2 alerting.
    const { replyText, usages } = await runCompanionTurn(pool, {
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
    await usageCostRepo.recordLlmUsages(pool, { turnId: kindlyTurn.id, conversationId, parentId, usages });

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
