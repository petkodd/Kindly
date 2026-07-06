import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveAdmin, errorToResponse } from '@/lib/auth';
import { adminRepo } from '@/lib/repos/admin';
import { auditRepo } from '@/lib/repos/audit';

const forbidden = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Admin access required.' } }, { status: 401 });

/** Operational overview metrics for the admin dashboard. Audit-logged. */
export async function GET(req: NextRequest) {
  const adminId = await resolveAdmin(req);
  if (!adminId) return forbidden();
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
