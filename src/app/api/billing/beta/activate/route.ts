import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db, withTransaction } from '@/lib/db';
import { resolveBuyer, readJsonBody, errorToResponse } from '@/lib/auth';
import { isFoundingBetaEnabled, getFoundingBetaDurationDays } from '@/lib/foundingBeta';
import { betaInviteRepo, normalizeInviteEmail, type BetaInvite } from '@/lib/repos/betaInvite';
import { parentRepo } from '@/lib/repos/parent';
import { subscriptionRepo } from '@/lib/repos/subscription';
import { rateLimitRepo } from '@/lib/repos/rateLimit';
import { auditRepo } from '@/lib/repos/audit';
import { userRepo } from '@/lib/repos/user';
import type { Querier } from '@/lib/querier';
import { RateLimitError, ValidationError } from '@/lib/types';

const unauthorized = () =>
  NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });

const notAvailable = () =>
  NextResponse.json(
    { error: { code: 'beta_not_available', message: 'The founding family beta is not available right now.' } },
    { status: 503 },
  );

// Single generic response for every invalid-invite case (unknown token,
// wrong email, expired, revoked, already redeemed by someone else) — never
// distinguishes the reason, so this can't be used as an oracle for guessing
// tokens or confirming which emails were invited.
const invalidInvite = () =>
  NextResponse.json(
    { error: { code: 'invalid_invite', message: 'This invitation link is invalid, expired, or already used.' } },
    { status: 400 },
  );

// Keyed on both the caller AND a token fingerprint (never the raw token, and
// never reversible to it — see tokenFingerprint below) so neither a single
// account hammering many tokens, nor a single leaked/guessed token hammered
// from many accounts, gets more than a handful of tries per window.
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60 * 1000;

function tokenFingerprint(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex').slice(0, 16);
}

/** Internal-only signal: the invite turned out invalid once we were already inside the transaction (a lost redemption race resolved to "not this caller"). Mapped back to the generic invalidInvite() response outside. Never leaks past this module. */
class InviteNoLongerValid extends Error {}

/**
 * Activate a Founding Family Beta entitlement from a one-time invite token.
 * Never calls Stripe. See db/migrations/0013_founding_family_beta.sql and
 * subscriptionRepo.grantBeta for the entitlement model this writes to.
 *
 * Atomicity: marking the invite redeemed, granting the subscription
 * entitlement, and recording the audit event all happen inside ONE
 * withTransaction call (src/lib/db.ts) — on real Postgres, either all three
 * commit together or none do, so a downstream failure (e.g. the audit
 * insert) rolls the invite redemption back too rather than leaving it
 * permanently consumed with no entitlement. As defense-in-depth beyond the
 * transaction (e.g. the DB commits but the process dies before the response
 * is sent), grantBeta's own idempotency check + the redeemed-by-me replay
 * branch below mean a retry with the same caller and invite always converges
 * to exactly one entitlement rather than an error — see
 * betaActivate.route.test.ts's recovery tests, which exercise exactly that
 * retry path (pg-mem, used in tests, does not actually discard writes on
 * ROLLBACK — see the note on withTransaction — so those tests validate the
 * retry-recovers guarantee rather than the rollback mechanics themselves;
 * the rollback mechanics were validated manually against real Postgres, see
 * docs/founding-family-beta.md).
 */
export async function POST(req: NextRequest) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) return unauthorized();
  if (!isFoundingBetaEnabled()) return notAvailable();

  try {
    const pool = db();
    const body = await readJsonBody(req);
    const parentId = body.parent_id as string;
    const rawToken = typeof body.invite_token === 'string' ? body.invite_token : '';
    if (!parentId) throw new ValidationError('parent_id is required');
    if (!rawToken) return invalidInvite();

    const [userRl, tokenRl] = await Promise.all([
      rateLimitRepo.hit(pool, `betaactivate:user:${buyerId}`, { limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS }),
      rateLimitRepo.hit(pool, `betaactivate:token:${tokenFingerprint(rawToken)}`, { limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS }),
    ]);
    if (!userRl.allowed || !tokenRl.allowed) throw new RateLimitError('Too many attempts. Please try again later.');

    // Isolation check before any invite state is touched — same ordering
    // rationale as the Stripe checkout route ("checked before any
    // billing-config state is revealed").
    await parentRepo.getOwned(pool, parentId, buyerId);

    // Read-only lookups — no need for these to be part of the write
    // transaction below.
    const invite = await betaInviteRepo.findByToken(pool, rawToken);
    const buyer = await userRepo.getAccount(pool, buyerId);
    const callerEmail = normalizeInviteEmail(buyer.email);

    if (!invite || normalizeInviteEmail(invite.email_normalized) !== callerEmail) {
      return invalidInvite();
    }
    if (invite.status !== 'pending' && !(invite.status === 'redeemed' && invite.redeemed_by_user_id === buyerId)) {
      // expired / revoked / already redeemed by a different account.
      return invalidInvite();
    }
    // Either still pending (the normal case) or already redeemed by this
    // same caller — a safe idempotent replay (returning to Step 5, a
    // double-click, or a retry after a prior partial failure). Either way,
    // everything from here on writes, so it all happens in one transaction.

    const days = getFoundingBetaDurationDays();

    let redeemedInvite!: BetaInvite;
    let grant!: Awaited<ReturnType<typeof subscriptionRepo.grantBeta>>;
    try {
      await withTransaction(pool, async (client: Querier) => {
        redeemedInvite = invite;
        if (invite.status === 'pending') {
          const result = await betaInviteRepo.markRedeemed(client, invite.id, buyerId);
          if (result) {
            redeemedInvite = result;
          } else {
            // Lost the redemption race to a concurrent request — re-read
            // (within this transaction's read-committed view, so this sees
            // the winner's already-committed row) to see whether it was
            // THIS caller's own concurrent request that won, or a
            // genuinely invalid state.
            const fresh = await betaInviteRepo.findByToken(client, rawToken);
            if (!fresh || fresh.status !== 'redeemed' || fresh.redeemed_by_user_id !== buyerId) {
              throw new InviteNoLongerValid();
            }
            redeemedInvite = fresh;
          }
        }

        grant = await subscriptionRepo.grantBeta(client, {
          buyerId,
          parentId,
          betaInviteId: redeemedInvite.id,
          days,
        });

        await auditRepo.log(client, {
          actorId: buyerId,
          action: 'founding_family_beta.activated',
          targetType: 'subscription',
          targetId: grant.subscription?.id ?? null,
          meta: {
            invite_id: redeemedInvite.id,
            parent_id: parentId,
            outcome: grant.outcome,
            beta_started_at: grant.subscription?.created_at ?? null,
            beta_ends_at: grant.subscription?.current_period_end ?? null,
            duration_days: days,
          },
        });
      });
    } catch (err) {
      if (err instanceof InviteNoLongerValid) return invalidInvite();
      throw err;
    }

    return NextResponse.json({ ok: true, already_active: grant.outcome === 'existing_paid_access' });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
