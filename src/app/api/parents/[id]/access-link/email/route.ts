import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, readJsonBody, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';
import { accessTokenRepo } from '@/lib/repos/accessToken';
import { userRepo } from '@/lib/repos/user';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { getEmailClient } from '@/lib/email';
import { talkLinkEmail } from '@/lib/email/templates';
import { SITE } from '@/lib/seo';
import { NotFoundError, ValidationError } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };

/**
 * "Email it to me": send the parent's talk link to the signed-in buyer's own
 * account address. The server never stores raw tokens, so the client sends
 * back the link it was just shown; it is accepted only if it is a currently
 * active token for THIS parent (owned by this buyer). The recipient is always
 * the buyer — never an address from the request. 5 per hour per buyer.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const params = await ctx.params;
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  try {
    const pool = db();
    const parent = await parentRepo.getOwned(pool, params.id, buyerId); // isolation
    const body = await readJsonBody(req);
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token) throw new ValidationError('token is required');
    await rateLimitRepo.enforce(pool, `talklinkemail:${buyerId}`, {
      limit: 5,
      windowMs: 60 * 60 * 1000,
      message: 'We’ve emailed this link a few times already. Please check your inbox, or try again in an hour.',
    });
    let tokenParent: string | null = null;
    try {
      tokenParent = await accessTokenRepo.resolveParentId(pool, token);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    if (tokenParent !== parent.id) {
      throw new ValidationError('That link is no longer active. Make a new link, then email it.');
    }
    const account = await userRepo.getAccount(pool, buyerId);
    const talkUrl = `${SITE.url}/app/talk?token=${encodeURIComponent(token)}`;
    await getEmailClient().send({ to: account.email, ...talkLinkEmail({ parentFirstName: parent.first_name, talkUrl }) });
    return NextResponse.json({ ok: true, sent_to: account.email });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
