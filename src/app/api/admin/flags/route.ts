import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminId, errorToResponse } from '@/lib/auth';
import { safetyFlagRepo } from '@/lib/repos/safetyFlag';
import { auditRepo } from '@/lib/repos/audit';

const forbidden = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Admin access required.' } }, { status: 401 });

/** Safety flag review queue (open + reviewing), highest severity first. */
export async function GET(req: NextRequest) {
  const adminId = getAdminId(req);
  if (!adminId) return forbidden();
  try {
    const pool = db();
    const flags = await safetyFlagRepo.queue(pool);
    await auditRepo.log(pool, { actorId: adminId, action: 'view_flags', targetType: 'safety_flag' });
    return NextResponse.json({ flags });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
