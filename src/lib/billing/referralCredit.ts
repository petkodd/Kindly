import type { Querier } from '../querier';
import { referralRepo, type Referral } from '../repos/referral';
import { referralRewardRepo, type RewardSide } from '../repos/referralReward';
import { subscriptionRepo } from '../repos/subscription';
import { auditRepo } from '../repos/audit';
import { getStripeClient, getPriceIdForInterval, type BillingInterval } from './index';

/**
 * "Give a month, get a month" (chat 11). Idea from Petko's commit a71b3fd:
 * credit one month of the plan to each side's Stripe customer balance
 * (a negative balance transaction, so Stripe takes it off the next invoice;
 * chosen over mutating the subscription so it also works across plan or
 * interval changes). Reimplemented so the credit is applied only after the
 * REDEEMER'S first PAID invoice (invoice.paid with amount_paid > 0), never at
 * redemption time.
 *
 * At most once per side, guaranteed three ways: the referral_id UNIQUE row,
 * the per-side claim (compare-and-set in referralRewardRepo.claimSide) and a
 * Stripe idempotency key per (referral, side). The webhook also dedupes
 * event ids, so a redelivered event is skipped before it gets here.
 */

export class ReferralCreditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferralCreditError';
  }
}

const priceCache = new Map<BillingInterval, { unitAmount: number; currency: string }>();

/** Test seam. */
export function resetReferralPriceCache(): void {
  priceCache.clear();
}

/**
 * One month's worth of the plan the customer pays for: the monthly price, or
 * 1/12 of the annual price for a yearly subscriber (the "Option B" noted in
 * src/lib/billing/index.ts). Read live from the configured Stripe Price.
 */
export async function oneMonthCredit(interval: BillingInterval): Promise<{ amountCents: number; currency: string }> {
  let price = priceCache.get(interval);
  if (!price) {
    const p = await getStripeClient().prices.retrieve(getPriceIdForInterval(interval));
    if (p.unit_amount == null) throw new ReferralCreditError(`price for ${interval} has no fixed amount`);
    price = { unitAmount: p.unit_amount, currency: p.currency };
    priceCache.set(interval, price);
  }
  const amountCents = interval === 'year' ? Math.round(price.unitAmount / 12) : price.unitAmount;
  return { amountCents, currency: price.currency };
}

type SideOutcome = 'applied' | 'skipped' | 'no_customer' | 'error';

async function applySide(
  q: Querier,
  referral: Referral,
  side: RewardSide,
  /** Stripe customer to credit when the caller already knows it (the paying customer of this invoice). */
  knownCustomerId: string | null,
): Promise<SideOutcome> {
  const userId = side === 'referrer' ? referral.referrer_id : referral.redeemed_by;
  const sub = userId ? await subscriptionRepo.latestStripeSubscriptionForBuyer(q, userId) : null;
  const customerId = knownCustomerId ?? sub?.stripe_customer_id ?? null;

  if (!customerId) {
    // Already recorded as waiting for a Stripe customer: don't re-claim and
    // re-audit on every later invoice of the other family (review fix).
    const reward = await referralRewardRepo.getByReferralId(q, referral.id);
    const status = side === 'referrer' ? reward?.referrer_status : reward?.referred_status;
    const reason = side === 'referrer' ? reward?.referrer_failure_reason : reward?.referred_failure_reason;
    if (status === 'failed' && reason === 'no_stripe_customer') return 'no_customer';
  }

  if (!(await referralRewardRepo.claimSide(q, referral.id, side))) return 'skipped';
  const audit = (action: string, meta: Record<string, unknown>) =>
    auditRepo.log(q, { actorId: null, action, targetType: 'referral', targetId: referral.id, meta: { side, ...meta } });

  if (!customerId) {
    // Typical for a referrer who has never paid through Stripe (e.g. beta).
    // Not an error: retried when that referrer's own invoice is paid.
    await referralRewardRepo.markSideFailed(q, referral.id, side, 'no_stripe_customer');
    await audit('referral_credit_failed', { reason: 'no_stripe_customer' });
    return 'no_customer';
  }

  try {
    const { amountCents, currency } = await oneMonthCredit(sub?.billing_interval ?? 'month');
    const txn = await getStripeClient().customers.createBalanceTransaction(
      customerId,
      { amount: -amountCents, currency, description: 'Dearly referral credit: one free month' },
      { idempotencyKey: `referral-credit:${referral.id}:${side}` },
    );
    await referralRewardRepo.markSideApplied(q, referral.id, side, { txnId: txn.id, amountCents, currency });
    await audit('referral_credit_applied', { amount_cents: amountCents, currency, stripe_txn_id: txn.id });
    return 'applied';
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown_error';
    await referralRewardRepo.markSideFailed(q, referral.id, side, reason);
    await audit('referral_credit_failed', { reason: reason.slice(0, 200) });
    console.error('referral credit failed', side, (err as Error)?.name);
    return 'error';
  }
}

/**
 * Called by the billing webhook for every PAID invoice (amount_paid > 0) of
 * `buyerId`, whose Stripe customer is `customerId`:
 *  1. if this buyer redeemed a referral code, apply both credits (only the
 *     first paid invoice does anything; later ones find both sides applied);
 *  2. if this buyer is a referrer whose credit could not be applied earlier
 *     (no Stripe customer yet), apply it now to this customer.
 *
 * Throws ReferralCreditError if a Stripe call failed, AFTER every side was
 * attempted and recorded, so the webhook answers 500 and Stripe redelivers
 * the event; the retry only re-attempts the failed sides.
 */
export async function applyReferralCreditsForPaidInvoice(
  q: Querier,
  input: { buyerId: string; customerId: string },
): Promise<{ applied: number }> {
  const outcomes: SideOutcome[] = [];

  const redeemed = await referralRepo.getRedeemedBy(q, input.buyerId);
  if (redeemed) {
    await referralRewardRepo.getOrCreate(q, {
      referralId: redeemed.id,
      referrerUserId: redeemed.referrer_id,
      referredUserId: input.buyerId,
    });
    outcomes.push(await applySide(q, redeemed, 'referred', input.customerId));
    outcomes.push(await applySide(q, redeemed, 'referrer', null));
  }

  for (const reward of await referralRewardRepo.unappliedForReferrer(q, input.buyerId)) {
    const { rows } = await q.query<Referral>(`SELECT * FROM referrals WHERE id = $1`, [reward.referral_id]);
    if (rows[0]) outcomes.push(await applySide(q, rows[0], 'referrer', input.customerId));
  }

  if (outcomes.includes('error')) throw new ReferralCreditError('a referral credit could not be applied');
  return { applied: outcomes.filter((o) => o === 'applied').length };
}
