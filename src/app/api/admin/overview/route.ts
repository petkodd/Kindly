import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveAdmin, adminForbidden, errorToResponse } from '@/lib/auth';
import { adminRepo } from '@/lib/repos/admin';
import { auditRepo } from '@/lib/repos/audit';

/** Operational overview metrics for the admin dashboard. Audit-logged. */
export async function GET(req: NextRequest) {
  const adminId = await resolveAdmin(req);
  if (!adminId) return adminForbidden();
  try {
    const pool = db();
    const overview = await adminRepo.overview(pool);
    await auditRepo.log(pool, { actorId: adminId, action: 'view_overview', targetType: 'admin' });
    return NextResponse.json({ overview });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
