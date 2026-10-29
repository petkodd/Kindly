import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { auditRepo } from '@/lib/repos/audit';
import { buildAccountExport } from '@/lib/repos/accountExport';
import { RateLimitError } from '@/lib/types';

const HOUR = 60 * 60 * 1000;

/**
 * GET /api/me/export — the signed-in buyer's data as a JSON download (see
 * buildAccountExport for exactly what is and isn't included). At most one
 * export per hour per account. Audit-logged.
 */
export async function GET(req: NextRequest) {
  const userId = await resolveBuyer(req);
  if (!userId) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  }
  try {
    const pool = db();
    const rl = await rateLimitRepo.hit(pool, `export:user:${userId}`, { limit: 1, windowMs: HOUR });
    if (!rl.allowed) throw new RateLimitError('You can download your data once an hour. Please try again later.');

    const doc = await buildAccountExport(pool, userId);
    await auditRepo.log(pool, { actorId: userId, action: 'data_export', targetType: 'user', targetId: userId });

    const filename = `dearly-export-${doc.exported_at.slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(doc, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
