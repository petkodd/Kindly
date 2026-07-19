import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAuthorizedCron } from '@/lib/auth';
import { retryReferralRewards } from '@/lib/jobs/retryReferralRewards';

// This route triggers DB + Stripe work and must never be statically cached.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Daily cron entrypoint for retryReferralRewards. Invoked by Vercel Cron
 * (see vercel.json) with `Authorization: Bearer $CRON_SECRET` — same gate as
 * the other job routes.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Forbidden.' } },
      { status: 401 },
    );
  }

  try {
    const result = await retryReferralRewards(db());
    if (result.attempted > 0) {
      console.info(
        `retry-referral-rewards: attempted ${result.attempted}, ${result.applied} fully applied`,
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('retry-referral-rewards job failed', err);
    return NextResponse.json(
      { error: { code: 'server_error', message: 'Job failed.' } },
      { status: 500 },
    );
  }
}
