import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateWeeklySummaries } from '@/lib/jobs/weeklySummary';

// This route triggers DB work and must never be statically cached.
export const dynamic = 'force-dynamic';

/**
 * Weekly cron entrypoint for `generate_weekly_summary`. Invoked by Vercel Cron
 * (see vercel.json), which sends `Authorization: Bearer $CRON_SECRET`. We refuse
 * unless the secret is configured and matches — an unprotected job route would
 * let anyone trigger a full regeneration pass.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Forbidden.' } },
      { status: 401 },
    );
  }

  try {
    const result = await generateWeeklySummaries(db());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('generate-weekly-summary job failed', err);
    return NextResponse.json(
      { error: { code: 'server_error', message: 'Job failed.' } },
      { status: 500 },
    );
  }
}
