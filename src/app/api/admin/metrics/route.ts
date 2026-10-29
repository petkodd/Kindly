import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveAdmin, adminForbidden, errorToResponse } from '@/lib/auth';
import { adminMetricsRepo } from '@/lib/repos/adminMetrics';
import { auditRepo } from '@/lib/repos/audit';

/**
 * Cost & retention metrics for the admin dashboard. Aggregates, plus the top
 * 10 spenders under a pseudonymous 8-character ref (no parent_id, name or
 * conversation content anywhere in the response). Audit-logged.
 * See docs/admin_metrics_definitions.md for the metric definitions.
 */
export async function GET(req: NextRequest) {
  const adminId = await resolveAdmin(req);
  if (!adminId) return adminForbidden();
  try {
    const pool = db();
    const granularity = req.nextUrl.searchParams.get('granularity') === 'week' ? 'week' : 'day';
    const [retention, cost_buckets, top_spenders] = await Promise.all([
      adminMetricsRepo.retention(pool),
      adminMetricsRepo.costBuckets(pool, granularity),
      adminMetricsRepo.topSpenders(pool),
    ]);
    await auditRepo.log(pool, {
      actorId: adminId,
      action: 'view_metrics',
      targetType: 'admin',
      meta: { granularity },
    });
    return NextResponse.json({ retention, cost_buckets, top_spenders, granularity });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
