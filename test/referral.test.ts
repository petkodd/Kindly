import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { consentRepo } from '../src/lib/repos/consent';
import { referralRepo } from '../src/lib/repos/referral';
import { summaryRepo } from '../src/lib/repos/summary';
import { NotFoundError, PreconditionError, ValidationError } from '../src/lib/types';

let q: Querier;

async function makeUser(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

async function makeParent(): Promise<string> {
  const parent = await parentRepo.create(q, {
    buyerId: await makeUser(`b${Math.random()}@example.com`),
    firstName: 'Robert',
    relationship: 'father',
  });
  return parent.id;
}

beforeEach(() => {
  q = makeTestDb();
});

describe('sibling invite (pending → accepted)', () => {
  it('starts pending and is excluded from delivery until accepted', async () => {
    const parentId = await makeParent();
    const { inviteToken } = await consentRepo.recordRecipientInvite(q, {
      parentId,
      recipientEmail: 'mike@example.com',
    });

    // Pending → not an accepted recipient yet.
    expect(await consentRepo.listAcceptedRecipients(q, parentId)).toHaveLength(0);
    // ...so a send has no eligible recipient.
    await expect(summaryRepo.send(q, parentId, 'Robert', new Date())).rejects.toBeInstanceOf(
      PreconditionError,
    );

    // Accept the invite.
    await consentRepo.acceptRecipientInvite(q, inviteToken);
    expect(await consentRepo.listAcceptedRecipients(q, parentId)).toHaveLength(1);

    // Now delivery works.
    const { deliveries } = await summaryRepo.send(q, parentId, 'Robert', new Date());
    expect(deliveries).toHaveLength(1);
  });

  it('rejects an unknown/used invite token without revealing validity', async () => {
    await expect(consentRepo.acceptRecipientInvite(q, 'bogus')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a malformed recipient email up front', async () => {
    const parentId = await makeParent();
    await expect(
      consentRepo.recordRecipientInvite(q, { parentId, recipientEmail: 'not-an-email' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('a directly-seeded recipient (no status) still counts as accepted', async () => {
    const parentId = await makeParent();
    await consentRepo.record(q, { parentId, kind: 'summary_recipient' });
    expect(await consentRepo.listAcceptedRecipients(q, parentId)).toHaveLength(1);
  });
});

describe('referral codes', () => {
  it('generates a unique code and redeems it once', async () => {
    const referrer = await makeUser('ref@example.com');
    const redeemer = await makeUser('new@example.com');
    const referral = await referralRepo.generate(q, referrer);
    expect(referral.code).toHaveLength(8);

    const redeemed = await referralRepo.redeem(q, referral.code, {
      redeemerId: redeemer,
      householdHash: 'hh-1',
    });
    expect(redeemed.redeemed_by).toBe(redeemer);
    expect(redeemed.redeemed_at).not.toBeNull();

    // Second redemption of the same code fails.
    await expect(
      referralRepo.redeem(q, referral.code, {
        redeemerId: await makeUser('other@example.com'),
        householdHash: 'hh-2',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('requires a household hash (the guard cannot be disabled by omission)', async () => {
    const referral = await referralRepo.generate(q, await makeUser('ref@example.com'));
    await expect(
      // @ts-expect-error omitting householdHash at runtime
      referralRepo.redeem(q, referral.code, { redeemerId: await makeUser('x@example.com') }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects redeeming your own code', async () => {
    const referrer = await makeUser('ref@example.com');
    const referral = await referralRepo.generate(q, referrer);
    await expect(
      referralRepo.redeem(q, referral.code, { redeemerId: referrer, householdHash: 'hh' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('fraud guard: at most one redemption per household', async () => {
    const household = 'household-hash-abc';
    const r1 = await referralRepo.generate(q, await makeUser('r1@example.com'));
    const r2 = await referralRepo.generate(q, await makeUser('r2@example.com'));

    await referralRepo.redeem(q, r1.code, {
      redeemerId: await makeUser('h1@example.com'),
      householdHash: household,
    });
    // A different code, different user, but SAME household → blocked.
    await expect(
      referralRepo.redeem(q, r2.code, {
        redeemerId: await makeUser('h2@example.com'),
        householdHash: household,
      }),
    ).rejects.toBeInstanceOf(PreconditionError);
  });
});
