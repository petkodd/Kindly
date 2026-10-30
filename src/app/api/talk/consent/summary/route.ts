import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, readJsonBody, errorToResponse } from '@/lib/auth';
import { consentRepo } from '@/lib/repos/consent';
import { parentRepo } from '@/lib/repos/parent';
import { buildSummarySharingNotice } from '@/lib/talk/summaryNotice';
import { ValidationError } from '@/lib/types';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Valid access token required.' } }, { status: 401 });

/**
 * The parent's answer to the summary-sharing notice: { answer: 'yes' | 'not_now',
 * version, text }. `version` and `text` echo the notice the screen showed. The
 * server rebuilds the notice and stores ITS text, so a client can never put
 * different words on record; if the notice changed since it was shown (for
 * example a new family member was invited in between), nothing is recorded
 * and the response is 409 `notice_changed` with the current notice to show.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const parentId = await resolveParentFromRequest(req, pool);
    if (!parentId) return unauthorized();
    const body = await readJsonBody(req);
    const answer = body.answer;
    if (answer !== 'yes' && answer !== 'not_now') throw new ValidationError("answer must be 'yes' or 'not_now'");

    const parent = await parentRepo.getById(pool, parentId);
    const notice = await buildSummarySharingNotice(pool, parent);
    if (body.version !== notice.version || body.text !== notice.text) {
      return NextResponse.json(
        {
          error: { code: 'notice_changed', message: 'The notice changed. Please read it again.' },
          summary_notice: { ...notice, audio_url: null },
        },
        { status: 409 },
      );
    }

    const consent = await consentRepo.recordSummarySharingAnswer(pool, {
      parentId,
      answer,
      noticeText: notice.text,
      noticeVersion: notice.version,
    });
    return NextResponse.json({ answer, consent_id: consent.id }, { status: 201 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
