import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';

/**
 * Send a magic sign-in link. ALWAYS returns 200 — never reveals whether the
 * email is registered (no user enumeration). Email delivery is mocked in Alpha
 * (EMAIL_API_KEY unset); the link-verification endpoint is a follow-up.
 */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const body = await readJsonBody(req);
    const email = (body.email as string) ?? '';
    const user = await userRepo.findByEmail(pool, email);
    if (user) {
      // TODO(feature/auth): generate a short-lived magic token + send via the
      // email provider. Mocked here so the endpoint reveals nothing.
      console.info(`magic link requested for a known account`);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
