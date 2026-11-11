import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, errorToResponse, clientIp } from '@/lib/auth';
import { enforceTalkRate } from '@/lib/talk/limits';
import { parentRepo } from '@/lib/repos/parent';
import { conversationRepo } from '@/lib/repos/conversation';
import { usageCostRepo } from '@/lib/repos/usageCost';
import { companionGreetingV2 } from '@/lib/ai/prompts';
import { getSpeechClient } from '@/lib/speech';
import { talkContextFor, talkSettingsFor } from '@/lib/talk/serverContext';
import { buildSummarySharingNotice, summarySharingNoticeDue } from '@/lib/talk/summaryNotice';
import type { SummarySharingNoticePayload } from '@/lib/talk/notices';
import { alertContactFirstName, resolveAlertContact } from '@/lib/safety/alerts';
import type { Querier } from '@/lib/querier';

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
 * - `summary_notice` (chat 9): when the parent hasn't answered the
 *   summary-sharing notice yet, its text, version and spoken audio. The talk
 *   screen shows it with Yes / Not now before the conversation starts.
 *
 * On the parent's very first session the greeting also says that Dearly
 * remembers things and who can see them (decision D8, companionGreetingV2).
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const parentId = await resolveParentFromRequest(req, pool);
    if (!parentId) return unauthorized();
    // A new session costs a spoken greeting, so it counts against the talk limits too.
    await enforceTalkRate(pool, parentId, clientIp(req));

    const parent = await parentRepo.getById(pool, parentId);
    const firstSession = (await countConversations(pool, parentId)) === 0;
    const conversation = await conversationRepo.openSession(pool, parentId, 'text');
    const selfUse = parent.relationship === 'self';
    const memoryViewer = firstSession && !selfUse
      ? alertContactFirstName((await resolveAlertContact(pool, parent))?.fullName)
      : null;
    const greeting = companionGreetingV2(parent.first_name, { firstSession, selfUse, memoryViewer });
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

    let summaryNotice: SummarySharingNoticePayload | null = null;
    try {
      if (await summarySharingNoticeDue(pool, parentId)) {
        const notice = await buildSummarySharingNotice(pool, parent);
        summaryNotice = { ...notice, audio_url: null };
        try {
          ({ audioUrl: summaryNotice.audio_url } = await getSpeechClient().textToSpeech(notice.text, {
            speechRate: parent.speech_rate,
          }));
          await usageCostRepo
            .recordTtsCost(pool, {
              turnId: null,
              conversationId: conversation.id,
              parentId,
              characterCount: notice.text.length,
            })
            .catch((err) => console.error('usage cost write failed (summary notice)', conversation.id, err));
        } catch (err) {
          console.error('summary notice speech failed', conversation.id, err);
          summaryNotice.audio_url = null;
        }
      }
    } catch (err) {
      // Never block the conversation on the notice: without a "Yes" nothing is
      // shared anyway, and the notice is offered again next time.
      console.error('summary notice lookup failed', parentId, err);
      summaryNotice = null;
    }

    return NextResponse.json(
      {
        conversation_id: conversation.id,
        greeting,
        greeting_audio_url: greetingAudioUrl,
        settings: talkSettingsFor(parent),
        summary_notice: summaryNotice,
        ...context,
      },
      { status: 201 },
    );
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

async function countConversations(q: Querier, parentId: string): Promise<number> {
  const { rows } = await q.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM conversations WHERE parent_id = $1`,
    [parentId],
  );
  return rows[0]?.n ?? 0;
}
