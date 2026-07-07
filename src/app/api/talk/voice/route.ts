import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { conversationRepo } from '@/lib/repos/conversation';
import { memoryRepo } from '@/lib/repos/memory';
import { safetyFlagRepo } from '@/lib/repos/safetyFlag';
import { getAiClient } from '@/lib/ai';
import type { ConversationTurn, RetrievedMemory, SafetyScan } from '@/lib/ai';
import { crisisResourceV1 } from '@/lib/ai/prompts';
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
 * Pipeline: STT → safety scan + companion reply (concurrent) → TTS → log
 * voice_minutes. Same safety contract as the text turn: P0/P1 crisis resources
 * always prepend the reply; scan failures fail safe (P2 for human review).
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

    const ai = getAiClient();

    // Safety scan and companion reply run concurrently — same contract as text turn.
    const scanPromise = ai
      .safetyScan({ message: transcript })
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
      message: transcript,
    });

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

    const replyText =
      scan.severity === 'p0' || scan.severity === 'p1'
        ? `${crisisResourceV1(scan.severity)}\n\n${reply.text}`
        : reply.text;

    // --- TTS runs before persisting, mirroring the text-turn invariant: turns
    // are written only after the full pipeline succeeds, so a TTS failure never
    // leaves the client unsure whether the turn "took" (which would risk a retry
    // re-submitting the same audio and duplicating the exchange).
    const { audioUrl } = await speech.textToSpeech(replyText, {
      speechRate: parent.speech_rate,
    });

    // Persist the exchange now that we have a reply AND synthesized audio.
    await conversationRepo.addTurn(pool, conversationId, parentId, 'parent', transcript);
    await conversationRepo.addTurn(pool, conversationId, parentId, 'kindly', replyText);
    await conversationRepo.addVoiceMinutes(pool, conversationId, parentId, durationSeconds);

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
