import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { parentRepo } from '../src/lib/repos/parent';
import { consentRepo } from '../src/lib/repos/consent';
import { conversationRepo } from '../src/lib/repos/conversation';
import { accessTokenRepo } from '../src/lib/repos/accessToken';
import { memoryRepo } from '../src/lib/repos/memory';
import { summaryRepo, lastCompletedWeekRef, weekBounds } from '../src/lib/repos/summary';
import { purgeHardDeletes } from '../src/lib/jobs/purge';
import { endIdleSessions } from '../src/lib/jobs/endIdleSessions';
import { generateWeeklySummaries } from '../src/lib/jobs/weeklySummary';
import { fakeEmailClient } from '../src/lib/email/fake';
import { makeBuyer, authedReq } from './routes/helpers';

let q: Querier;
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, db: () => q };
});

const stripeMock = { cancel: vi.fn(), retrieve: vi.fn(), constructEvent: vi.fn() };
vi.mock('@/lib/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing')>();
  return {
    ...actual,
    getStripeClient: () => ({
      subscriptions: { cancel: stripeMock.cancel, retrieve: stripeMock.retrieve },
      webhooks: { constructEvent: stripeMock.constructEvent },
    }),
  };
});

// Imported AFTER the mocks.
import { DELETE as meDELETE, PATCH as mePATCH } from '../src/app/api/me/route';
import { DELETE as parentDELETE } from '../src/app/api/parents/[id]/route';
import { GET as exportGET } from '../src/app/api/me/export/route';
import { POST as webhookPOST } from '../src/app/api/billing/webhook/route';
import { POST as messagePOST } from '../src/app/api/talk/message/route';
import { GET as previewGET } from '../src/app/api/parents/[id]/summary/preview/route';
import { POST as acceptPOST } from '../src/app/api/invites/accept/route';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  stripeMock.cancel.mockReset().mockResolvedValue({ id: 'sub', status: 'canceled' });
  stripeMock.retrieve.mockReset();
  stripeMock.constructEvent.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

async function readyParent(buyerId?: string) {
  const buyer = buyerId ?? (await makeBuyer(q, `b${Math.random()}@example.com`));
  const parent = await parentRepo.create(q, { buyerId: buyer, firstName: 'Ruth', relationship: 'mother' });
  await consentRepo.record(q, { parentId: parent.id, kind: 'buyer_attestation', grantedBy: buyer });
  await parentRepo.activate(q, parent.id, buyer);
  await consentRepo.record(q, { parentId: parent.id, kind: 'parent_conversation' });
  return { buyer, parent };
}

async function addStripeSub(buyerId: string, parentId: string, stripeSubId: string, status = 'active') {
  await q.query(
    `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, stripe_sub_id, current_period_end)
     VALUES ($1, $2, 'family', $3, $4, now() + interval '20 days')`,
    [buyerId, parentId, status, stripeSubId],
  );
}

const subStatus = async (stripeSubId: string) =>
  (await q.query<{ status: string }>(`SELECT status FROM subscriptions WHERE stripe_sub_id = $1`, [stripeSubId])).rows[0]?.status;
const isDeleted = async (table: 'users' | 'parents', id: string) =>
  (await q.query<{ deleted_at: Date | null }>(`SELECT deleted_at FROM ${table} WHERE id = $1`, [id])).rows[0]?.deleted_at !== null;

describe('1. deleting cancels Stripe and revokes talk links', () => {
  it('account delete: cancels every subscription in Stripe, marks them canceled, revokes links, then soft-deletes', async () => {
    const { buyer, parent } = await readyParent();
    const second = await readyParent(buyer);
    await addStripeSub(buyer, parent.id, 'sub_A');
    await addStripeSub(buyer, second.parent.id, 'sub_B');
    const { token } = await accessTokenRepo.issue(q, parent.id);

    const res = await meDELETE(authedReq('http://localhost/api/me', buyer, { method: 'DELETE' }));
    expect(res.status).toBe(202);
    expect(stripeMock.cancel.mock.calls.map((c) => c[0]).sort()).toEqual(['sub_A', 'sub_B']);
    expect(await subStatus('sub_A')).toBe('canceled');
    expect(await subStatus('sub_B')).toBe('canceled');
    await expect(accessTokenRepo.resolveParentId(q, token)).rejects.toThrow();
    expect(await isDeleted('users', buyer)).toBe(true);
  });

  it('parent delete: cancels only that parent’s subscription and revokes its links', async () => {
    const { buyer, parent } = await readyParent();
    const other = await readyParent(buyer);
    await addStripeSub(buyer, parent.id, 'sub_A');
    await addStripeSub(buyer, other.parent.id, 'sub_B');

    const res = await parentDELETE(authedReq(`http://localhost/api/parents/${parent.id}`, buyer, { method: 'DELETE' }), {
      params: Promise.resolve({ id: parent.id }),
    });
    expect(res.status).toBe(202);
    expect(stripeMock.cancel).toHaveBeenCalledTimes(1);
    expect(stripeMock.cancel).toHaveBeenCalledWith('sub_A');
    expect(await subStatus('sub_B')).toBe('active');
    expect(await isDeleted('parents', parent.id)).toBe(true);
  });

  it('is idempotent: a sub Stripe already cancelled or no longer knows counts as done', async () => {
    const { buyer, parent } = await readyParent();
    await addStripeSub(buyer, parent.id, 'sub_gone');
    stripeMock.cancel.mockRejectedValueOnce(Object.assign(new Error('No such subscription'), { code: 'resource_missing' }));
    expect((await meDELETE(authedReq('http://localhost/api/me', buyer, { method: 'DELETE' }))).status).toBe(202);
    // A retry finds nothing live and calls Stripe no more.
    await userRepoSoftDeleteAgain(buyer);
    expect(stripeMock.cancel).toHaveBeenCalledTimes(1);
  });

  it('Stripe unreachable → 503 and NOTHING is deleted (never keep charging a deleted profile)', async () => {
    const { buyer, parent } = await readyParent();
    await addStripeSub(buyer, parent.id, 'sub_A');
    stripeMock.cancel.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    stripeMock.retrieve.mockRejectedValueOnce(new Error('timeout'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await meDELETE(authedReq('http://localhost/api/me', buyer, { method: 'DELETE' }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('billing_unavailable');
    expect(await isDeleted('users', buyer)).toBe(false);
    expect(await subStatus('sub_A')).toBe('active');
  });

  it('no Stripe key while a Stripe subscription exists → 503; a beta-only parent is cancelled locally', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const a = await readyParent();
    await addStripeSub(a.buyer, a.parent.id, 'sub_A');
    expect((await meDELETE(authedReq('http://localhost/api/me', a.buyer, { method: 'DELETE' }))).status).toBe(503);

    const b = await readyParent();
    await q.query(
      `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, current_period_end) VALUES ($1, $2, 'family', 'beta', now() + interval '5 days')`,
      [b.buyer, b.parent.id],
    );
    expect((await meDELETE(authedReq('http://localhost/api/me', b.buyer, { method: 'DELETE' }))).status).toBe(202);
    const { rows } = await q.query<{ status: string }>(`SELECT status FROM subscriptions WHERE buyer_id = $1`, [b.buyer]);
    expect(rows[0].status).toBe('canceled');
    expect(stripeMock.cancel).not.toHaveBeenCalled();
  });
});

async function userRepoSoftDeleteAgain(userId: string) {
  const { userRepo } = await import('../src/lib/repos/user');
  await userRepo.softDelete(q, userId);
}

describe('2. purge', () => {
  it('purges a beta user (who redeemed and created invites) instead of crashing the run', async () => {
    const admin = await makeBuyer(q, 'admin@example.com');
    const { buyer } = await readyParent();
    await q.query(
      `INSERT INTO beta_invites (email_normalized, token_hash, status, expires_at, created_by_user_id, redeemed_by_user_id, redeemed_at)
       VALUES ('x@example.com', 'h1', 'redeemed', now() + interval '9 days', $1, $2, now())`,
      [buyer, buyer],
    );
    await q.query(
      `INSERT INTO beta_invites (email_normalized, token_hash, expires_at, created_by_user_id) VALUES ('y@example.com', 'h2', now() + interval '9 days', $1)`,
      [admin],
    );
    await q.query(`UPDATE users SET deleted_at = now() - interval '31 days' WHERE id = $1`, [buyer]);

    const result = await purgeHardDeletes(q);
    expect(result).toMatchObject({ purgedUsers: 1, failedUsers: 0 });
    const { rows } = await q.query<{ redeemed_by_user_id: string | null; created_by_user_id: string | null }>(
      `SELECT redeemed_by_user_id, created_by_user_id FROM beta_invites WHERE token_hash = 'h1'`,
    );
    expect(rows[0]).toEqual({ redeemed_by_user_id: null, created_by_user_id: null });
  });

  it('one user’s failure does not stop the others; it is counted and retried next run', async () => {
    const a = await makeBuyer(q, 'a@example.com');
    const b = await makeBuyer(q, 'b@example.com');
    await q.query(`UPDATE users SET deleted_at = now() - interval '40 days' WHERE id IN ($1, $2)`, [a, b]);
    const realQuery = q.query.bind(q);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(q, 'query').mockImplementation((async (text: string, params?: unknown[]) => {
      if (/DELETE FROM users WHERE id = \$1/.test(text) && params?.[0] === a) throw Object.assign(new Error('boom'), { code: 'XX000' });
      return realQuery(text, params);
    }) as typeof q.query);

    const result = await purgeHardDeletes(q);
    expect(result.failedUsers).toBe(1);
    expect(result.purgedUsers).toBe(1);
  });
});

describe('3. abandoned sessions', () => {
  it('every turn gets a 30-day retention backstop when it is written', async () => {
    const { parent } = await readyParent();
    await addStripeSub(parent.buyer_id, parent.id, `sub_${Math.random()}`);
    const convo = await conversationRepo.openSession(q, parent.id);
    const turn = await conversationRepo.addTurn(q, convo.id, parent.id, 'parent', 'hello');
    const days = (new Date(turn.retention_purge_at as unknown as string).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('the sweeper ends conversations idle for 30+ minutes and runs the session-end jobs; active ones stay open', async () => {
    const { parent } = await readyParent();
    await addStripeSub(parent.buyer_id, parent.id, `sub_${Math.random()}`);
    const idle = await conversationRepo.openSession(q, parent.id);
    await conversationRepo.addTurn(q, idle.id, parent.id, 'parent', 'I love gardening');
    await q.query(`UPDATE conversations SET started_at = now() - interval '2 hours' WHERE id = $1`, [idle.id]);
    await q.query(`UPDATE conversation_turns SET created_at = now() - interval '45 minutes' WHERE conversation_id = $1`, [idle.id]);
    const active = await conversationRepo.openSession(q, parent.id);
    await q.query(`UPDATE conversations SET started_at = now() - interval '2 hours' WHERE id = $1`, [active.id]);
    await conversationRepo.addTurn(q, active.id, parent.id, 'parent', 'still here');

    const result = await endIdleSessions(q);
    expect(result).toMatchObject({ ended: 1, failed: 0 });
    const ended = await conversationRepo.getForParent(q, idle.id, parent.id);
    expect(ended.ended_at).not.toBeNull();
    expect(ended.summary_text).toBeTruthy(); // session-end jobs ran
    expect((await conversationRepo.getForParent(q, active.id, parent.id)).ended_at).toBeNull();
  });
});

describe('4. talk gates are re-checked on every turn', () => {
  it('withdrawing consent or billing lapsing mid-conversation stops the next turn', async () => {
    const { buyer, parent } = await readyParent();
    await addStripeSub(buyer, parent.id, 'sub_A');
    const { token } = await accessTokenRepo.issue(q, parent.id);
    const convo = await conversationRepo.openSession(q, parent.id);
    const say = () =>
      messagePOST(new NextRequest('http://localhost/api/talk/message', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversation_id: convo.id, content: 'Hello' }),
      }));
    expect((await say()).status).toBe(200);

    await q.query(`UPDATE subscriptions SET status = 'canceled' WHERE stripe_sub_id = 'sub_A'`);
    const lapsed = await say();
    expect(lapsed.status).toBe(402);
    expect((await lapsed.json()).error.message).toMatch(/ask your family to check the account/);

    await q.query(`UPDATE subscriptions SET status = 'active' WHERE stripe_sub_id = 'sub_A'`);
    await q.query(`UPDATE consents SET revoked_at = now() WHERE parent_id = $1 AND kind = 'parent_conversation'`, [parent.id]);
    expect((await say()).status).toBe(403);
  });
});

describe('5. Stripe webhook', () => {
  const subEvent = (id: string, created: number, status: string, buyerId: string, parentId: string) => ({
    id,
    created,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_W',
        customer: 'cus_1',
        status,
        metadata: { buyer_id: buyerId, parent_id: parentId },
        items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 86400, price: { recurring: { interval: 'month' } } }] },
      },
    },
  });
  const post = () =>
    webhookPOST(new NextRequest('http://localhost/api/billing/webhook', { method: 'POST', headers: { 'stripe-signature': 't=1,v1=x' }, body: '{}' }));

  it('a redelivered event is acknowledged once and not applied twice', async () => {
    const { buyer, parent } = await readyParent();
    stripeMock.constructEvent.mockReturnValue(subEvent('evt_1', 1_000, 'active', buyer, parent.id));
    expect((await post()).status).toBe(200);
    await q.query(`UPDATE subscriptions SET status = 'past_due' WHERE stripe_sub_id = 'sub_W'`); // later change
    const again = await post();
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(await subStatus('sub_W')).toBe('past_due'); // the duplicate did not re-apply 'active'
  });

  it('an older event arriving late never overwrites newer state', async () => {
    const { buyer, parent } = await readyParent();
    stripeMock.constructEvent.mockReturnValue(subEvent('evt_new', 2_000, 'canceled', buyer, parent.id));
    await post();
    stripeMock.constructEvent.mockReturnValue(subEvent('evt_old', 1_000, 'active', buyer, parent.id));
    await post();
    expect(await subStatus('sub_W')).toBe('canceled');
  });
});

describe('6. data export', () => {
  it('downloads the account, parents, memories, summaries, consents and transcripts in retention; once an hour', async () => {
    const { buyer, parent } = await readyParent();
    await memoryRepo.add(q, { parentId: parent.id, layer: 'core', key: 'hometown', value: 'Tulsa', source: 'family' });
    await consentRepo.recordRecipientInvite(q, { parentId: parent.id, grantedBy: buyer, recipientEmail: 'sib@example.com' });
    await q.query(`INSERT INTO subscriptions (buyer_id, parent_id, plan, status, current_period_end) VALUES ($1, $2, 'family', 'active', now() + interval '9 days')`, [buyer, parent.id]);
    const convo = await conversationRepo.openSession(q, parent.id);
    await conversationRepo.addTurn(q, convo.id, parent.id, 'parent', 'kept turn');
    const old = await conversationRepo.addTurn(q, convo.id, parent.id, 'parent', 'expired turn');
    await q.query(`UPDATE conversation_turns SET retention_purge_at = now() - interval '1 day' WHERE id = $1`, [old.id]);
    await q.query(`INSERT INTO safety_flags (parent_id, severity, detail) VALUES ($1, 'p3_abuse', 'staff note')`, [parent.id]);

    const res = await exportGET(authedReq('http://localhost/api/me/export', buyer));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="dearly-export-\d{4}-\d{2}-\d{2}\.json"/);
    const doc = await res.json();
    const p = doc.parents[0];
    expect(doc.account.id).toBe(buyer);
    expect(p.memories.map((m: { key: string }) => m.key)).toEqual(['hometown']);
    expect(p.conversations[0].turns.map((t: { content: string }) => t.content)).toEqual(['kept turn']);
    expect(JSON.stringify(doc)).not.toMatch(/invite_token_hash|password|staff note|p3_abuse/);
    expect(p.consents.some((c: { kind: string }) => c.kind === 'summary_recipient')).toBe(true);

    const second = await exportGET(authedReq('http://localhost/api/me/export', buyer));
    expect(second.status).toBe(429);
  });
});

describe('7. weekly summaries (D5)', () => {
  it('preview is read-only and covers the last full week; manual send uses the same week', async () => {
    const { buyer, parent } = await readyParent();
    const before = (await q.query(`SELECT COUNT(*)::int AS n FROM weekly_summaries`)).rows[0].n;
    const res = await previewGET(authedReq(`http://localhost/api/parents/${parent.id}/summary/preview`, buyer), {
      params: Promise.resolve({ id: parent.id }),
    });
    const { summary } = await res.json();
    expect(summary.period_start).toBe(weekBounds(lastCompletedWeekRef()).periodStart);
    expect(summary.id).toBeNull();
    expect((await q.query(`SELECT COUNT(*)::int AS n FROM weekly_summaries`)).rows[0].n).toBe(before);

    const accepted = await consentRepo.recordRecipientInvite(q, { parentId: parent.id, grantedBy: buyer, recipientEmail: 'sib@example.com' });
    await consentRepo.acceptRecipientInvite(q, accepted.inviteToken);
    const sent = await summaryRepo.send(q, parent.id, 'Ruth');
    expect(sent.summary.period_start).toBe(summary.period_start);
  });

  it('the cron auto-sends only for buyers who opted in, and only when someone accepted', async () => {
    const optedIn = await readyParent();
    const notOpted = await readyParent();
    for (const p of [optedIn, notOpted]) {
      const inv = await consentRepo.recordRecipientInvite(q, { parentId: p.parent.id, grantedBy: p.buyer, recipientEmail: `r${Math.random()}@example.com` });
      await consentRepo.acceptRecipientInvite(q, inv.inviteToken);
    }
    const res = await mePATCH(authedReq('http://localhost/api/me', optedIn.buyer, { method: 'PATCH', body: JSON.stringify({ auto_send_summaries: true }) }));
    expect((await res.json()).account.auto_send_summaries).toBe(true);
    vi.spyOn(fakeEmailClient, 'send').mockResolvedValue({ id: 'provider-1' });

    const result = await generateWeeklySummaries(q);
    expect(result.sent.map((s) => s.parentId)).toEqual([optedIn.parent.id]);
    expect(result.sent[0].delivered).toBe(1);
    expect(result.generated.map((g) => g.parentId).sort()).toEqual([optedIn.parent.id, notOpted.parent.id].sort());
  });

  it('the cron does not auto-send for a buyer whose email is unconfirmed (chat 7), but still builds the preview', async () => {
    const p = await readyParent();
    const inv = await consentRepo.recordRecipientInvite(q, { parentId: p.parent.id, grantedBy: p.buyer, recipientEmail: 'r@example.com' });
    await consentRepo.acceptRecipientInvite(q, inv.inviteToken);
    await q.query(`UPDATE users SET auto_send_summaries = true, email_verified_at = NULL WHERE id = $1`, [p.buyer]);
    const send = vi.spyOn(fakeEmailClient, 'send').mockResolvedValue({ id: 'provider-1' });

    const result = await generateWeeklySummaries(q);
    expect(result.sent).toEqual([]);
    expect(result.generated.map((g) => g.parentId)).toEqual([p.parent.id]);
    expect(send).not.toHaveBeenCalled();
  });

  it('auto_send_summaries must be a boolean', async () => {
    const buyer = await makeBuyer(q, 'x@example.com');
    const res = await mePATCH(authedReq('http://localhost/api/me', buyer, { method: 'PATCH', body: JSON.stringify({ auto_send_summaries: 'yes' }) }));
    expect(res.status).toBe(400);
  });
});

describe('8. summary invites expire after 14 days', () => {
  it('a 15-day-old invite gets a clear 410; a fresh one is accepted', async () => {
    const { buyer, parent } = await readyParent();
    const old = await consentRepo.recordRecipientInvite(q, { parentId: parent.id, grantedBy: buyer, recipientEmail: 'old@example.com' });
    await q.query(`UPDATE consents SET granted_at = now() - interval '15 days' WHERE id = $1`, [old.consent.id]);
    const accept = (token: string) =>
      acceptPOST(new NextRequest('http://localhost/api/invites/accept', { method: 'POST', body: JSON.stringify({ token }) }));

    const expired = await accept(old.inviteToken);
    expect(expired.status).toBe(410);
    expect((await expired.json()).error.message).toMatch(/expired/);

    const fresh = await consentRepo.recordRecipientInvite(q, { parentId: parent.id, grantedBy: buyer, recipientEmail: 'new@example.com' });
    expect((await accept(fresh.inviteToken)).status).toBe(200);
    expect((await accept('not-a-token')).status).toBe(404);
  });
});
