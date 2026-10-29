import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { conversationRepo } from '@/lib/repos/conversation';
import { usageCostRepo } from '@/lib/repos/usageCost';
import { companionGreetingV1 } from '@/lib/ai/prompts';
import { getSpeechClient } from '@/lib/speech';
import { talkContextFor, talkSettingsFor } from '@/lib/talk/serverContext';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Valid access token required.' } }, { status: 401 });

/**
 * Open a conversation. 403 (ForbiddenError) if no parent_conversation consent.
 * Returns a greeting that discloses Dearly is an AI, stored as the first turn,
 * plus:
 * - `greeting_audio_url`: the greeting spoken aloud, so the AI disclosure is
 *   heard and not only read. Null if speech synthesis fails: the conversation
 *   still opens and the greeting is shown as text.
 * - `settings`: the profile's talk settings (large text, voice first, pace).
 * - `family_first_name` / `link_owner`: for plain "ask Sarah for a new link"
 *   copy if the link later stops working.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const parentId = await resolveParentFromRequest(req, pool);
    if (!parentId) return unauthorized();

    const parent = await parentRepo.getById(pool, parentId);
    const conversation = await conversationRepo.openSession(pool, parentId, 'text');
    const greeting = companionGreetingV1(parent.first_name);
    const greetingTurn = await conversationRepo.addTurn(pool, conversation.id, parentId, 'kindly', greeting);

    let greetingAudioUrl: string | null = null;
    try {
      ({ audioUrl: greetingAudioUrl } = await getSpeechClient().textToSpeech(greeting, {
        speechRate: parent.speech_rate,
      }));
      try {
        await usageCostRepo.recordTtsCost(pool, {
          turnId: greetingTurn.id,
          conversationId: conversation.id,
          parentId,
          characterCount: greeting.length,
        });
      } catch (err) {
        console.error('usage cost write failed (greeting)', conversation.id, err);
      }
    } catch (err) {
      console.error('greeting speech failed', conversation.id, err);
      greetingAudioUrl = null;
    }

    let context: Awaited<ReturnType<typeof talkContextFor>> = { family_first_name: null, link_owner: 'family' };
    try {
      context = await talkContextFor(pool, parent);
    } catch (err) {
      console.error('talk context lookup failed', parentId, err);
    }

    return NextResponse.json(
      {
        conversation_id: conversation.id,
        greeting,
        greeting_audio_url: greetingAudioUrl,
        settings: talkSettingsFor(parent),
        ...context,
      },
      { status: 201 },
    );
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
