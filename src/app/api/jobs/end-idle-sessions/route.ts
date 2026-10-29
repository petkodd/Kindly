import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAuthorizedCron } from '@/lib/auth';
import { endIdleSessions } from '@/lib/jobs/endIdleSessions';

// This route triggers DB work and must never be statically cached.
export const dynamic = 'force-dynamic';
// Session-end jobs make model calls; give a full batch room.
export const maxDuration = 300;

/**
 * Cron (daily at 04:30 UTC, see vercel.json; the Vercel Hobby plan allows
 * only daily crons): end conversations idle for more than 30 minutes and run
 * their session-end jobs. Runs just before the 05:00 purge. On a paid plan it
 * can run every 15 minutes so summaries appear sooner. Bearer CRON_SECRET only.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Forbidden.' } }, { status: 401 });
  }
  try {
    const result = await endIdleSessions(db());
    if (result.ended > 0 || result.failed > 0) {
      console.info(`end-idle-sessions: ended ${result.ended}, failed ${result.failed}${result.more ? ', more remain' : ''}`);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('end-idle-sessions job failed', err);
    return NextResponse.json({ error: { code: 'server_error', message: 'Job failed.' } }, { status: 500 });
  }
}
