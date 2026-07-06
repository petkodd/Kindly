import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveAdmin, adminForbidden, errorToResponse } from '@/lib/auth';
import { safetyFlagRepo } from '@/lib/repos/safetyFlag';
import { auditRepo } from '@/lib/repos/audit';

/** Safety flag review queue (open + reviewing), highest severity first. */
export async function GET(req: NextRequest) {
  const adminId = await resolveAdmin(req);
  if (!adminId) return adminForbidden();
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
