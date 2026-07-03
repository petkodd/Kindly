import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminId, readJsonBody, errorToResponse } from '@/lib/auth';
import { safetyFlagRepo } from '@/lib/repos/safetyFlag';
import { auditRepo } from '@/lib/repos/audit';
import { ValidationError, type FlagStatus } from '@/lib/types';

type Ctx = { params: { fid: string } };

const forbidden = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Admin access required.' } }, { status: 401 });

/** Update a flag's status (reviewing / resolved / dismissed). Audit-logged. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const adminId = getAdminId(req);
  if (!adminId) return forbidden();
  try {
    const pool = db();
    const body = await readJsonBody(req);
    const status = body.status as FlagStatus;
    if (!status) throw new ValidationError('status is required');

    const flag = await safetyFlagRepo.updateStatus(pool, params.fid, status, adminId);
    await auditRepo.log(pool, {
      actorId: adminId,
      action: 'update_flag',
      targetType: 'safety_flag',
      targetId: params.fid,
      meta: { status },
    });
    return NextResponse.json({ flag });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
