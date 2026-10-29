import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import {
  assertSafeSeedTarget,
  demoPasswordFrom,
  seedDemo,
  SEED_IDS,
  DEMO_EMAIL,
  ADMIN_EMAIL,
} from '../db/seed-lib.mjs';
import { userRepo } from '../src/lib/repos/user';
import { accessTokenRepo } from '../src/lib/repos/accessToken';
import { subscriptionRepo } from '../src/lib/repos/subscription';
import { conversationRepo } from '../src/lib/repos/conversation';
import { consentRepo } from '../src/lib/repos/consent';
import { summaryRepo } from '../src/lib/repos/summary';

const LOCAL = 'postgres://kindly:kindly@localhost:5432/kindly';

describe('db:seed localhost guard', () => {
  it('allows localhost and 127.0.0.1 and returns the host', () => {
    expect(assertSafeSeedTarget({ DATABASE_URL: LOCAL })).toBe('localhost');
    expect(assertSafeSeedTarget({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/kindly' })).toBe('127.0.0.1');
    expect(assertSafeSeedTarget({ DATABASE_URL: LOCAL, NODE_ENV: 'development' })).toBe('localhost');
  });

  it.each([
    ['a managed host', 'postgres://u:p@ep-cool-name.us-east-2.aws.neon.tech/neondb'],
    ['a look-alike host', 'postgres://u:p@localhost.evil.example.com/kindly'],
    ['a LAN address', 'postgres://u:p@192.168.1.20:5432/kindly'],
    ['IPv6 loopback (not on the allow-list)', 'postgres://u:p@[::1]:5432/kindly'],
    ['no host (socket)', 'postgres:///kindly'],
  ])('refuses %s', (_label, url) => {
    expect(() => assertSafeSeedTarget({ DATABASE_URL: url })).toThrow(/Refusing to seed/);
  });

  it('refuses a localhost URL whose ?host= or ?hostaddr= would redirect the connection', () => {
    expect(() =>
      assertSafeSeedTarget({ DATABASE_URL: `${LOCAL}?host=db.prod.example.com` }),
    ).toThrow(/"host" query parameter/);
    expect(() => assertSafeSeedTarget({ DATABASE_URL: `${LOCAL}?hostaddr=10.0.0.5` })).toThrow(
      /"hostaddr" query parameter/,
    );
  });

  it('refuses when NODE_ENV or VERCEL_ENV is production, even on localhost', () => {
    expect(() => assertSafeSeedTarget({ DATABASE_URL: LOCAL, NODE_ENV: 'production' })).toThrow(
      /NODE_ENV is "production"/,
    );
    expect(() => assertSafeSeedTarget({ DATABASE_URL: LOCAL, VERCEL_ENV: 'production' })).toThrow(
      /VERCEL_ENV is "production"/,
    );
  });

  it('refuses a missing, malformed or non-postgres DATABASE_URL', () => {
    expect(() => assertSafeSeedTarget({})).toThrow(/DATABASE_URL is not set/);
    expect(() => assertSafeSeedTarget({ DATABASE_URL: 'not a url' })).toThrow(/not a valid/);
    expect(() => assertSafeSeedTarget({ DATABASE_URL: 'mysql://localhost/kindly' })).toThrow(/postgres:\/\//);
  });

  it('never echoes the password from the URL', () => {
    try {
      assertSafeSeedTarget({ DATABASE_URL: 'postgres://admin:s3cret-pw@prod.example.com/db' });
    } catch (err) {
      expect((err as Error).message).toContain('prod.example.com');
      expect((err as Error).message).not.toContain('s3cret-pw');
    }
  });

  it('requires DEMO_PASSWORD of at least 8 characters', () => {
    expect(() => demoPasswordFrom({})).toThrow(/DEMO_PASSWORD/);
    expect(() => demoPasswordFrom({ DEMO_PASSWORD: 'short' })).toThrow(/at least 8/);
    expect(demoPasswordFrom({ DEMO_PASSWORD: 'long-enough' })).toBe('long-enough');
  });
});

describe('seedDemo', () => {
  let q: Querier;
  const PASSWORD = 'demo-pass-123';
  const NOW = new Date('2026-10-21T15:00:00Z'); // a Wednesday

  const count = async (sql: string, params: unknown[] = []) =>
    (await q.query<{ n: number }>(sql, params)).rows[0].n;

  beforeEach(() => {
    q = makeTestDb();
  });

  it('creates the full demo dataset', async () => {
    const { token } = await seedDemo(q, { password: PASSWORD, now: NOW });
    const P = SEED_IDS.parent;

    // Users: organizer + admin, both able to log in with DEMO_PASSWORD.
    const demo = await userRepo.verifyCredentials(q, DEMO_EMAIL, PASSWORD);
    const admin = await userRepo.verifyCredentials(q, ADMIN_EMAIL, PASSWORD);
    expect(demo?.is_admin).toBe(false);
    expect(admin?.is_admin).toBe(true);

    // Activated parent with attestation + parent consent + current beta subscription.
    const { rows: parents } = await q.query<{ first_name: string; activated_at: string | null }>(
      `SELECT first_name, activated_at FROM parents WHERE id = $1`,
      [P],
    );
    expect(parents[0].first_name).toBe('Mom (demo)');
    expect(parents[0].activated_at).not.toBeNull();
    expect(await consentRepo.has(q, P, 'buyer_attestation')).toBe(true);
    expect(await consentRepo.has(q, P, 'parent_conversation')).toBe(true);
    const sub = await subscriptionRepo.getForParent(q, P);
    expect(sub?.status).toBe('beta');
    expect(await subscriptionRepo.isBillingCurrent(q, P, NOW)).toBe(true);

    // 8 memories across all 5 layers, 1 sensitive, 2 proposed, none restricted (D6).
    expect(await count(`SELECT COUNT(*)::int AS n FROM memories WHERE parent_id = $1`, [P])).toBe(8);
    expect(await count(`SELECT COUNT(DISTINCT layer)::int AS n FROM memories WHERE parent_id = $1`, [P])).toBe(5);
    expect(await count(`SELECT COUNT(*)::int AS n FROM memories WHERE parent_id = $1 AND sensitivity = 'sensitive'`, [P])).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS n FROM memories WHERE parent_id = $1 AND sensitivity = 'restricted'`, [P])).toBe(0);
    expect(await count(`SELECT COUNT(*)::int AS n FROM memories WHERE parent_id = $1 AND status = 'proposed'`, [P])).toBe(2);

    // 3 ended conversations with turns and summaries, all in the past.
    const { rows: convs } = await q.query<{ id: string; ended_at: Date; summary_text: string }>(
      `SELECT id, ended_at, summary_text FROM conversations WHERE parent_id = $1`,
      [P],
    );
    expect(convs).toHaveLength(3);
    for (const c of convs) {
      expect(c.summary_text).toBeTruthy();
      expect(new Date(c.ended_at).getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
    expect(await count(`SELECT COUNT(*)::int AS n FROM conversation_turns t JOIN conversations c ON c.id = t.conversation_id WHERE c.parent_id = $1`, [P])).toBe(17);

    // Summary preview for the current week, 1 accepted recipient, 1 open P2 flag, usage costs.
    const { rows: sums } = await q.query<{ status: string; period_start: string | Date }>(
      `SELECT status, period_start FROM weekly_summaries WHERE parent_id = $1`,
      [P],
    );
    expect(sums).toHaveLength(1);
    expect(sums[0].status).toBe('preview');
    expect(new Date(sums[0].period_start).toISOString().slice(0, 10)).toBe('2026-10-19');
    expect((await consentRepo.listAcceptedRecipients(q, P)).map((c) => (c.detail as { recipient_email: string }).recipient_email)).toEqual(['sibling@kindly.test']);
    expect(await count(`SELECT COUNT(*)::int AS n FROM safety_flags WHERE parent_id = $1 AND severity = 'p2_welfare' AND status = 'open'`, [P])).toBe(1);
    // 17 speech rows (one per turn) + 2 model calls (scan + reply) per companion answer.
    expect(await count(`SELECT COUNT(*)::int AS n FROM usage_costs WHERE parent_id = $1 AND provider <> 'anthropic_llm'`, [P])).toBe(17);
    const answers = await count(`SELECT COUNT(*)::int AS n FROM usage_costs WHERE parent_id = $1 AND operation = 'reply'`, [P]);
    expect(answers).toBeGreaterThan(0);
    expect(await count(`SELECT COUNT(*)::int AS n FROM usage_costs WHERE parent_id = $1 AND provider = 'anthropic_llm'`, [P])).toBe(2 * answers);
    expect(await count(`SELECT COUNT(DISTINCT provider)::int AS n FROM usage_costs WHERE parent_id = $1`, [P])).toBe(3);

    // The printed talk link works: token resolves to the parent, and a session can open.
    expect(await accessTokenRepo.resolveParentId(q, token)).toBe(P);
    const convo = await conversationRepo.openSession(q, P, 'voice');
    expect(convo.parent_id).toBe(P);
  });

  it('is idempotent: a second run replaces the demo rows instead of duplicating them', async () => {
    const first = await seedDemo(q, { password: PASSWORD, now: NOW });
    const second = await seedDemo(q, { password: 'new-demo-pass', now: NOW });
    const P = SEED_IDS.parent;

    expect(await count(`SELECT COUNT(*)::int AS n FROM users`)).toBe(2);
    expect(await count(`SELECT COUNT(*)::int AS n FROM parents`)).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS n FROM memories`)).toBe(8);
    expect(await count(`SELECT COUNT(*)::int AS n FROM conversations`)).toBe(3);
    expect(await count(`SELECT COUNT(*)::int AS n FROM conversation_turns`)).toBe(17);
    expect(await count(`SELECT COUNT(*)::int AS n FROM usage_costs WHERE provider <> 'anthropic_llm'`)).toBe(17);
    expect(await count(`SELECT COUNT(*)::int AS n FROM weekly_summaries`)).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS n FROM safety_flags`)).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS n FROM consents`)).toBe(3);
    expect(await count(`SELECT COUNT(*)::int AS n FROM subscriptions`)).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS n FROM beta_invites`)).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS n FROM parent_access_tokens`)).toBe(1);

    // The password follows DEMO_PASSWORD; only the newest talk link works.
    expect(await userRepo.verifyCredentials(q, DEMO_EMAIL, 'new-demo-pass')).not.toBeNull();
    expect(await userRepo.verifyCredentials(q, DEMO_EMAIL, PASSWORD)).toBeNull();
    expect(await accessTokenRepo.resolveParentId(q, second.token)).toBe(P);
    await expect(accessTokenRepo.resolveParentId(q, first.token)).rejects.toThrow();
  });

  it('keeps an existing account with the demo email (upsert, never a duplicate)', async () => {
    await q.query(`INSERT INTO users (email) VALUES ($1)`, [DEMO_EMAIL]);
    await seedDemo(q, { password: PASSWORD, now: NOW });
    expect(await count(`SELECT COUNT(*)::int AS n FROM users WHERE email = $1`, [DEMO_EMAIL])).toBe(1);
    expect(await userRepo.verifyCredentials(q, DEMO_EMAIL, PASSWORD)).not.toBeNull();
  });

  it("sending the seeded summary records a 'simulated' delivery (no email key)", async () => {
    delete process.env.EMAIL_API_KEY;
    await seedDemo(q, { password: PASSWORD, now: NOW });
    const { deliveries } = await summaryRepo.send(q, SEED_IDS.parent, 'Mom (demo)', NOW);
    expect(deliveries.map((d) => d.status)).toEqual(['simulated']);
  });
});

describe('seedDemo memory order (what the simulated AI brings up first)', () => {
  it('surfaces a light memory first and the sensitive one last', async () => {
    const q = makeTestDb();
    await seedDemo(q, { password: 'demo-pass-123', now: new Date('2026-10-21T15:00:00Z') });
    const { memoryRepo } = await import('../src/lib/repos/memory');
    const mems = await memoryRepo.retrieveForCompanion(q, SEED_IDS.parent);
    expect(mems[0].mem_key).toBe('favorite_music');
    expect(mems[mems.length - 1].mem_key).toBe('late_spouse');
  });
});

describe('seedDemo family-facing text', () => {
  it('keeps the welfare detail out of every family-facing summary', async () => {
    const q = makeTestDb();
    await seedDemo(q, { password: 'demo-pass-123', now: new Date('2026-10-21T15:00:00Z') });
    const { rows: convs } = await q.query<{ summary_text: string }>(`SELECT summary_text FROM conversations`);
    const { rows: weekly } = await q.query<{ body_long: string }>(`SELECT body_long FROM weekly_summaries`);
    for (const text of [...convs.map((c) => c.summary_text), ...weekly.map((w) => w.body_long)]) {
      expect(text).not.toMatch(/skip|meal|lunch|not eating/i);
    }
  });
});
