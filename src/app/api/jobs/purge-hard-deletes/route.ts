import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAuthorizedCron } from '@/lib/auth';
import { purgeHardDeletes } from '@/lib/jobs/purge';

// This route triggers DB work and must never be statically cached.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily cron entrypoint for `purge_hard_deletes`. Invoked by Vercel Cron
 * (see vercel.json) with `Authorization: Bearer $CRON_SECRET` — same gate as
 * the weekly-summary job: an unprotected purge route would let anyone force
 * destructive deletes on demand.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Forbidden.' } },
      { status: 401 },
    );
  }

  try {
    const result = await purgeHardDeletes(db());
    if (
      result.purgedUsers > 0 ||
      result.purgedParents > 0 ||
      result.purgedTurns > 0 ||
      result.purgedWaitlistSignups > 0
    ) {
      // The cron response body is discarded; log so purges are visible in the
      // platform logs (counts only — never identities).
      console.info(
        `purge-hard-deletes: purged ${result.purgedUsers} users, ${result.purgedParents} parents, ${result.purgedTurns} turns, ${result.purgedWaitlistSignups} waitlist signups (cutoff ${result.cutoff})`,
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('purge-hard-deletes job failed', err);
    return NextResponse.json(
      { error: { code: 'server_error', message: 'Job failed.' } },
      { status: 500 },
    );
  }
}
