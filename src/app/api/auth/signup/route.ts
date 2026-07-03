import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readJsonBody, errorToResponse } from '@/lib/auth';
import { userRepo } from '@/lib/repos/user';
import { signSession, attachSession } from '@/lib/session';

/** Create a buyer account and start a session. 409 on duplicate email. */
export async function POST(req: NextRequest) {
  try {
    const pool = db();
    const body = await readJsonBody(req);
    const user = await userRepo.create(pool, {
      email: body.email as string,
      password: body.password as string,
    });
    // TODO(feature/admin-analytics): emit account_created.
    const token = signSession(user.id, { isAdmin: user.is_admin });
    const res = NextResponse.json({ user }, { status: 201 });
    return attachSession(res, token);
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
