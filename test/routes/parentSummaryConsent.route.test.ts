import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { consentRepo } from '../../src/lib/repos/consent';
import { accessTokenRepo } from '../../src/lib/repos/accessToken';
import { generateWeeklySummaries } from '../../src/lib/jobs/weeklySummary';
import { fakeSpeechClient } from '../../src/lib/speech/fake';
import { PARENT_CONVERSATION_NOTICE, PARENT_SUMMARY_SHARING_NOTICE_VERSION } from '../../src/lib/talk/notices';
import { summarySharingNoticeDue } from '../../src/lib/talk/summaryNotice';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

import { POST as talkConsentPOST } from '../../src/app/api/talk/consent/route';
import { POST as summaryConsentPOST } from '../../src/app/api/talk/consent/summary/route';
import { POST as sessionPOST } from '../../src/app/api/talk/session/route';

type Relationship = 'mother' | 'father' | 'self';

async function makeParent(
  opts: { buyerName?: string | null; relationship?: Relationship; email?: string } = {},
): Promise<{ parentId: string; buyerId: string; token: string }> {
  const email = opts.email ?? `b${Math.random()}@example.com`;
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email, full_name, email_verified_at, auto_send_summaries) VALUES ($1, $2, now(), true) RETURNING id`,
    [email, opts.buyerName === undefined ? 'Sarah Miller' : opts.buyerName],
  );
  const buyerId = rows[0].id;
  const parent = await parentRepo.create(q, {
    buyerId,
    firstName: 'Ruth',
    relationship: opts.relationship ?? 'mother',
  });
  await consentRepo.record(q, { parentId: parent.id, kind: 'buyer_attestation', grantedBy: buyerId });
  await parentRepo.activate(q, parent.id, buyerId);
  await q.query(
    `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, current_period_end)
     VALUES ($1, $2, 'family', 'trialing', now() + interval '7 days')`,
    [buyerId, parent.id],
  );
  const { token } = await accessTokenRepo.issue(q, parent.id);
  return { parentId: parent.id, buyerId, token };
}

function bearer(url: string, token: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function openSession(token: string) {
  await talkConsentPOST(bearer('http://localhost/api/talk/consent', token));
  const res = await sessionPOST(bearer('http://localhost/api/talk/session', token));
  expect(res.status).toBe(201);
  return res.json();
}

async function answer(token: string, notice: { version: string; text: string }, a: string) {
  return summaryConsentPOST(
    bearer('http://localhost/api/talk/consent/summary', token, { answer: a, version: notice.version, text: notice.text }),
  );
}

beforeEach(() => {
  q = makeTestDb();
});
afterEach(() => vi.restoreAllMocks());

describe('parent_conversation consent stores what the parent saw', () => {
  it('records the intro notice text and version', async () => {
    const { parentId, token } = await makeParent();
    const res = await talkConsentPOST(bearer('http://localhost/api/talk/consent', token));
    expect(res.status).toBe(201);
    const [c] = await consentRepo.list(q, parentId, 'parent_conversation');
    expect(c.detail).toMatchObject({
      notice_text: PARENT_CONVERSATION_NOTICE.text,
      notice_version: PARENT_CONVERSATION_NOTICE.version,
    });
    expect(PARENT_CONVERSATION_NOTICE.text).toContain('Dearly is an AI companion — not a real person.');
  });
});

describe('summary-sharing notice on the talk screen', () => {
  it('is shown (and spoken) on the first session, naming the buyer and the safety alert (D2)', async () => {
    const tts = vi.spyOn(fakeSpeechClient, 'textToSpeech');
    const { token } = await makeParent();
    const body = await openSession(token);
    expect(body.summary_notice.version).toBe(PARENT_SUMMARY_SHARING_NOTICE_VERSION);
    expect(body.summary_notice.text).toBe(
      'Each week, Sarah gets a short note about what we chatted about in general — never our conversations word for word. ' +
        'And if you ever seem to be in danger, I’ll let Sarah know so they can check on you. Is that OK?',
    );
    expect(body.summary_notice.audio_url).toMatch(/^data:audio\//);
    expect(tts).toHaveBeenCalledWith(body.summary_notice.text, expect.anything());
  });

  it('counts other invited family members without reading out their addresses', async () => {
    const { parentId, buyerId, token } = await makeParent({ email: 'sarah@example.com' });
    await consentRepo.recordRecipientInvite(q, { parentId, grantedBy: buyerId, recipientEmail: 'mike@example.com' });
    await consentRepo.recordRecipientInvite(q, { parentId, grantedBy: buyerId, recipientEmail: 'SARAH@example.com' });
    const { summary_notice: n } = await openSession(token);
    expect(n.text).toMatch(/^Each week, Sarah and 1 other family member get a short note/);
    expect(n.text).not.toMatch(/@/);
  });

  it('says "your family" when the buyer has no usable first name', async () => {
    const { token } = await makeParent({ buyerName: null });
    const { summary_notice: n } = await openSession(token);
    expect(n.text).toMatch(/^Each week, your family gets a short note/);
    expect(n.text).toMatch(/I’ll let your family know so they can check on you/);
  });

  it('self-use: no family alert goes out, so the safety sentence is left out', async () => {
    const { token } = await makeParent({ relationship: 'self' });
    const { summary_notice: n } = await openSession(token);
    expect(n.text).toMatch(/^Each week, the family members you invite get a short note/);
    expect(n.text).not.toMatch(/danger/);
  });

  it('Yes stores the exact notice text and version, and the notice is not shown again', async () => {
    const { parentId, token } = await makeParent();
    const { summary_notice: n } = await openSession(token);
    const res = await answer(token, n, 'yes');
    expect(res.status).toBe(201);
    const [c] = await consentRepo.list(q, parentId, 'parent_summary_sharing');
    expect(c.detail).toMatchObject({ answer: 'yes', notice_text: n.text, notice_version: n.version });
    expect((await openSession(token)).summary_notice).toBeNull();
    // A repeated Yes does not add rows.
    await answer(token, n, 'yes');
    expect(await consentRepo.list(q, parentId, 'parent_summary_sharing')).toHaveLength(1);
  });

  it('a client cannot put different words on record (409 notice_changed, nothing stored)', async () => {
    const { parentId, token } = await makeParent();
    const { summary_notice: n } = await openSession(token);
    const res = await answer(token, { version: n.version, text: 'Each week, nobody gets anything. Is that OK?' }, 'yes');
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('notice_changed');
    expect(body.summary_notice.text).toBe(n.text);
    expect(await consentRepo.latest(q, parentId, 'parent_summary_sharing')).toBeNull();
  });

  it('Not now is recorded but is not consent, and is asked again after 7 days', async () => {
    const { parentId, token } = await makeParent();
    const { summary_notice: n } = await openSession(token);
    expect((await answer(token, n, 'not_now')).status).toBe(201);
    expect(await consentRepo.has(q, parentId, 'parent_summary_sharing')).toBe(false);
    const last = await consentRepo.latest(q, parentId, 'parent_summary_sharing');
    expect(last?.detail).toMatchObject({ answer: 'not_now', notice_text: n.text });
    expect((await openSession(token)).summary_notice).toBeNull();
    // Repeating "Not now" inside the window doesn't pile up rows.
    await answer(token, n, 'not_now');
    const { rows } = await q.query(`SELECT * FROM consents WHERE kind = 'parent_summary_sharing'`);
    expect(rows).toHaveLength(1);
    const eightDaysOn = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await summarySharingNoticeDue(q, parentId, eightDaysOn)).toBe(true);
  });

  it('rejects anything but yes / not_now, and needs a talk token', async () => {
    const { token } = await makeParent();
    const { summary_notice: n } = await openSession(token);
    expect((await answer(token, n, 'maybe')).status).toBe(400);
    expect((await answer(null as unknown as string, n, 'yes')).status).toBe(401);
  });
});

describe('first-session greeting (D8)', () => {
  it('says Dearly remembers things and who can see them, only on the first session', async () => {
    const { token } = await makeParent();
    const first = await openSession(token);
    expect(first.greeting).toMatch(/AI companion, not a real person/);
    expect(first.greeting).toMatch(/I'll remember things you tell me, like your favorite music/);
    expect(first.greeting).toMatch(/Sarah can see what I remember, and you can ask me any time what I remember about you/);
    const second = await openSession(token);
    expect(second.greeting).not.toMatch(/remember/);
  });

  it('self-use points to their own account', async () => {
    const { token } = await makeParent({ relationship: 'self' });
    const first = await openSession(token);
    expect(first.greeting).toMatch(/You can see what I remember in your Dearly account/);
  });
});

describe('weekly auto-send needs the parent’s yes', () => {
  it('skips (not fails) a parent who has not said yes, and sends once they have', async () => {
    const { parentId, buyerId } = await makeParent();
    await consentRepo.record(q, {
      parentId,
      kind: 'summary_recipient',
      grantedBy: buyerId,
      detail: { recipient_email: 'mike@example.com', status: 'accepted' },
    });
    const before = await generateWeeklySummaries(q);
    expect(before.sent).toHaveLength(0);
    expect(before.failed).toHaveLength(0);

    await consentRepo.recordSummarySharingAnswer(q, {
      parentId,
      answer: 'yes',
      noticeText: 'x',
      noticeVersion: PARENT_SUMMARY_SHARING_NOTICE_VERSION,
    });
    const after = await generateWeeklySummaries(q);
    expect(after.sent.map((s) => s.parentId)).toEqual([parentId]);
  });
});
