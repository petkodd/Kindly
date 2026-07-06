import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveParentFromRequest, readJsonBody, errorToResponse } from '@/lib/auth';
import { conversationRepo } from '@/lib/repos/conversation';
import { runSessionEndJobs } from '@/lib/jobs/sessionEnd';
import { clearParentToken } from '@/lib/parentSession';
import { ValidationError } from '@/lib/types';

// Runs two model calls (summarize + extract) inline; give it headroom.
export const maxDuration = 60;

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Valid access token required.' } }, { status: 401 });

/**
 * End a session. The summarize + memory-extraction jobs are triggered from the
 * session-end slice; here we just close the conversation (idempotent).
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const parentId = await resolveParentFromRequest(req, pool);
    if (!parentId) return unauthorized();

    const body = await readJsonBody(req);
    const conversationId = body.conversation_id as string;
    if (!conversationId) throw new ValidationError('conversation_id is required');
    const conversation = await conversationRepo.end(pool, conversationId, parentId);

    // Best-effort session-end jobs (summarize + memory extraction). A model
    // failure must not fail the end — the session is already closed. Awaited so
    // the work actually runs (serverless kills the function after the response).
    let summarized = false;
    try {
      ({ summarized } = await runSessionEndJobs(pool, conversationId));
    } catch (jobErr) {
      console.error('session-end jobs failed', jobErr);
    }

    // Ending the session is the parent's "logout" — clear the talk cookie so a
    // shared device doesn't keep an ambient credential. Their original link
    // still works: opening it re-runs the token→cookie exchange.
    return clearParentToken(
      NextResponse.json({
        conversation_id: conversation.id,
        ended_at: conversation.ended_at,
        summarized,
      }),
    );
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
