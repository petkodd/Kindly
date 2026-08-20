import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveAdmin, adminForbidden, errorToResponse } from '@/lib/auth';
import { auditRepo } from '@/lib/repos/audit';
import {
  COMPANION_SYSTEM_V1,
  SAFETY_SCAN_SYSTEM_V1,
  MEMORY_EXTRACTION_SYSTEM_V1,
  CONVERSATION_SUMMARY_SYSTEM_V1,
} from '@/lib/ai/prompts';
import { getPromptSignOffStatus } from '@/lib/ai/promptSignOff';

const LIVE_PROMPTS: Record<string, string> = {
  COMPANION_SYSTEM_V1,
  SAFETY_SCAN_SYSTEM_V1,
  MEMORY_EXTRACTION_SYSTEM_V1,
  CONVERSATION_SUMMARY_SYSTEM_V1,
};

/**
 * Machine-readable prompt sign-off status, for the future "Reviewed for
 * safety" badge — see docs/PROMPT_SIGN_OFF.md. Computed live from
 * prompts/signoffs.json against the current prompt text on every request, so
 * it can never show a badge for a prompt that has since drifted.
 */
export async function GET(req: NextRequest) {
  const adminId = await resolveAdmin(req);
  if (!adminId) return adminForbidden();
  try {
    const pool = db();
    const prompts = Object.entries(LIVE_PROMPTS).map(([promptKey, text]) =>
      getPromptSignOffStatus(promptKey, text),
    );
    const allApproved = prompts.every((p) => p.fullyApproved);
    await auditRepo.log(pool, { actorId: adminId, action: 'view_prompt_signoff_status', targetType: 'prompt_signoff' });
    return NextResponse.json({ all_approved: allApproved, prompts });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
