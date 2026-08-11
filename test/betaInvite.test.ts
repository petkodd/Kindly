import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { betaInviteRepo } from '../src/lib/repos/betaInvite';

let q: Querier;

async function makeUser(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(`INSERT INTO users (email) VALUES ($1) RETURNING id`, [email]);
  return rows[0].id;
}

beforeEach(() => {
  q = makeTestDb();
});

describe('betaInviteRepo.issue', () => {
  it('returns a raw token once and stores only its hash', async () => {
    const { token, invite } = await betaInviteRepo.issue(q, { email: 'Family@Example.com', ttlDays: 14 });
    expect(token.length).toBeGreaterThanOrEqual(32); // base64url of >= 32 random bytes
    expect(invite.token_hash).not.toBe(token);
    expect(invite.email_normalized.toLowerCase()).toBe('family@example.com');
    expect(invite.status).toBe('pending');
  });

  it('rejects an invalid email', async () => {
    await expect(betaInviteRepo.issue(q, { email: 'not-an-email', ttlDays: 14 })).rejects.toThrow();
  });

  it('rejects a non-positive-integer ttlDays', async () => {
    await expect(betaInviteRepo.issue(q, { email: 'a@example.com', ttlDays: 0 })).rejects.toThrow();
    await expect(betaInviteRepo.issue(q, { email: 'a@example.com', ttlDays: -1 })).rejects.toThrow();
  });
});

describe('betaInviteRepo.findByToken', () => {
  it('resolves a known raw token to its invite row', async () => {
    const { token, invite } = await betaInviteRepo.issue(q, { email: 'a@example.com', ttlDays: 14 });
    const found = await betaInviteRepo.findByToken(q, token);
    expect(found?.id).toBe(invite.id);
  });

  it('returns null for an unknown token, and never throws — no oracle', async () => {
    expect(await betaInviteRepo.findByToken(q, 'totally-made-up')).toBeNull();
    expect(await betaInviteRepo.findByToken(q, '')).toBeNull();
  });
});

describe('betaInviteRepo.markRedeemed', () => {
  it('atomically flips a pending, unexpired invite to redeemed', async () => {
    const user = await makeUser('a@example.com');
    const { invite } = await betaInviteRepo.issue(q, { email: 'a@example.com', ttlDays: 14 });
    const redeemed = await betaInviteRepo.markRedeemed(q, invite.id, user);
    expect(redeemed?.status).toBe('redeemed');
    expect(redeemed?.redeemed_by_user_id).toBe(user);
    expect(redeemed?.redeemed_at).toBeTruthy();
  });

  it('a second redemption attempt on the same invite returns null (one-time use)', async () => {
    const user1 = await makeUser('a@example.com');
    const user2 = await makeUser('b@example.com');
    const { invite } = await betaInviteRepo.issue(q, { email: 'a@example.com', ttlDays: 14 });
    await betaInviteRepo.markRedeemed(q, invite.id, user1);
    const second = await betaInviteRepo.markRedeemed(q, invite.id, user2);
    expect(second).toBeNull();
  });

  it('parallel redemption attempts for the same invite succeed exactly once', async () => {
    const user1 = await makeUser('a@example.com');
    const user2 = await makeUser('b@example.com');
    const { invite } = await betaInviteRepo.issue(q, { email: 'a@example.com', ttlDays: 14 });
    const [r1, r2] = await Promise.all([
      betaInviteRepo.markRedeemed(q, invite.id, user1),
      betaInviteRepo.markRedeemed(q, invite.id, user2),
    ]);
    const successes = [r1, r2].filter(Boolean);
    expect(successes).toHaveLength(1);
  });

  it('an expired invite cannot be redeemed even while still nominally "pending"', async () => {
    const user = await makeUser('a@example.com');
    const { invite } = await betaInviteRepo.issue(q, { email: 'a@example.com', ttlDays: 14 });
    await q.query(`UPDATE beta_invites SET expires_at = now() - interval '1 hour' WHERE id = $1`, [invite.id]);
    const result = await betaInviteRepo.markRedeemed(q, invite.id, user);
    expect(result).toBeNull();
  });
});

describe('betaInviteRepo.revoke', () => {
  it('revokes a pending invite', async () => {
    const { invite } = await betaInviteRepo.issue(q, { email: 'a@example.com', ttlDays: 14 });
    const revoked = await betaInviteRepo.revoke(q, invite.id);
    expect(revoked?.status).toBe('revoked');
  });

  it('is a no-op on an already-redeemed invite (cannot un-redeem via revoke)', async () => {
    const user = await makeUser('a@example.com');
    const { invite } = await betaInviteRepo.issue(q, { email: 'a@example.com', ttlDays: 14 });
    await betaInviteRepo.markRedeemed(q, invite.id, user);
    const result = await betaInviteRepo.revoke(q, invite.id);
    expect(result).toBeNull();
  });

  it('a revoked invite can no longer be redeemed', async () => {
    const user = await makeUser('a@example.com');
    const { invite } = await betaInviteRepo.issue(q, { email: 'a@example.com', ttlDays: 14 });
    await betaInviteRepo.revoke(q, invite.id);
    const result = await betaInviteRepo.markRedeemed(q, invite.id, user);
    expect(result).toBeNull();
  });
});
