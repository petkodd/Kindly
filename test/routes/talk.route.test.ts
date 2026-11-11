import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { consentRepo } from '../../src/lib/repos/consent';
import { accessTokenRepo } from '../../src/lib/repos/accessToken';
import { PARENT_TOKEN_COOKIE } from '../../src/lib/parentSession';
import { fakeAiClient } from '../../src/lib/ai/fake';
import { SAFE_FALLBACK_REPLY } from '../../src/lib/ai/outputFilter';
import { fakeSpeechClient } from '../../src/lib/speech/fake';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { POST as talkAuthPOST } from '../../src/app/api/talk/auth/route';
import { POST as sessionPOST } from '../../src/app/api/talk/session/route';
import { POST as messagePOST } from '../../src/app/api/talk/message/route';
import { POST as sessionEndPOST } from '../../src/app/api/talk/session/end/route';

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

/** Activated parent with parent_conversation consent recorded (ready to talk). */
async function makeReadyParent(): Promise<{ parentId: string; token: string }> {
  const buyerId = await makeBuyer(`b${Math.random()}@example.com`);
  const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });
  await consentRepo.record(q, { parentId: parent.id, kind: 'buyer_attestation', grantedBy: buyerId });
  await parentRepo.activate(q, parent.id, buyerId);
  await consentRepo.record(q, { parentId: parent.id, kind: 'parent_conversation' });
  await q.query(
    `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, current_period_end)
     VALUES ($1, $2, 'family', 'trialing', now() + interval '7 days')`,
    [buyerId, parent.id],
  );
  const { token } = await accessTokenRepo.issue(q, parent.id);
  return { parentId: parent.id, token };
}

function bearerReq(url: string, token: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  q = makeTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/talk/auth', () => {
  it('401s an unknown token and sets no cookie', async () => {
    const res = await talkAuthPOST(bearerReq('http://localhost/api/talk/auth', null, { token: 'nope' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('exchanges a valid token for an httpOnly kindly_talk cookie', async () => {
    const buyerId = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });
    const { token } = await accessTokenRepo.issue(q, parent.id);

    const res = await talkAuthPOST(bearerReq('http://localhost/api/talk/auth', null, { token }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${PARENT_TOKEN_COOKIE}=${token}`);
    expect(setCookie.toLowerCase()).toContain('httponly');
  });

  it("returns the buyer's sanitized first name for plain 'ask Sarah for a new link' copy", async () => {
    const buyerId = await makeBuyer('sarah@example.com');
    await q.query(`UPDATE users SET full_name = $1 WHERE id = $2`, ['Sarah<script> Miller', buyerId]);
    const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });
    const { token } = await accessTokenRepo.issue(q, parent.id);

    const body = await (await talkAuthPOST(bearerReq('http://localhost/api/talk/auth', null, { token }))).json();
    expect(body).toMatchObject({ ok: true, family_first_name: 'Sarahscript', link_owner: 'family' });
  });

  it('a self-use profile has no family to name', async () => {
    const buyerId = await makeBuyer('me@example.com');
    const parent = await parentRepo.create(q, { buyerId, firstName: 'Me', relationship: 'self' });
    const { token } = await accessTokenRepo.issue(q, parent.id);
    const body = await (await talkAuthPOST(bearerReq('http://localhost/api/talk/auth', null, { token }))).json();
    expect(body).toMatchObject({ family_first_name: null, link_owner: 'self' });
  });
});

describe('POST /api/talk/session', () => {
  it('401s without a valid parent token', async () => {
    const res = await sessionPOST(bearerReq('http://localhost/api/talk/session', null));
    expect(res.status).toBe(401);
  });

  it('403s when parent_conversation consent is missing', async () => {
    const buyerId = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });
    await consentRepo.record(q, { parentId: parent.id, kind: 'buyer_attestation', grantedBy: buyerId });
    await parentRepo.activate(q, parent.id, buyerId);
    const { token } = await accessTokenRepo.issue(q, parent.id);

    const res = await sessionPOST(bearerReq('http://localhost/api/talk/session', token));
    expect(res.status).toBe(403);
  });

  it('opens a session and returns a greeting once consented', async () => {
    const { token } = await makeReadyParent();
    const res = await sessionPOST(bearerReq('http://localhost/api/talk/session', token));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.conversation_id).toBeTruthy();
    expect(body.greeting).toContain('Robert');
  });

  it('speaks the greeting (with the AI disclosure) and records its TTS cost', async () => {
    const tts = vi.spyOn(fakeSpeechClient, 'textToSpeech');
    const { token, parentId } = await makeReadyParent();
    await q.query(`UPDATE parents SET speech_rate = 'slow' WHERE id = $1`, [parentId]);
    const body = await (await sessionPOST(bearerReq('http://localhost/api/talk/session', token))).json();

    expect(tts).toHaveBeenCalledWith(body.greeting, { speechRate: 'slow' });
    expect(body.greeting).toMatch(/AI companion, not a real person/);
    expect(body.greeting_audio_url).toMatch(/^data:audio\/mp3;base64,/);
    // The greeting's TTS is tied to its turn. (A second, turn-less TTS row is
    // the spoken summary-sharing notice on a first session — chat 9.)
    const { rows } = await q.query<{ provider: string }>(
      `SELECT provider FROM usage_costs WHERE parent_id = $1 AND turn_id IS NOT NULL`,
      [parentId],
    );
    expect(rows.map((r) => r.provider)).toEqual(['elevenlabs_tts']);
  });

  it('returns the talk settings and who set Dearly up', async () => {
    const { token, parentId } = await makeReadyParent();
    await q.query(`UPDATE parents SET large_text = false, voice_first = false WHERE id = $1`, [parentId]);
    const body = await (await sessionPOST(bearerReq('http://localhost/api/talk/session', token))).json();
    expect(body.settings).toEqual({ large_text: false, voice_first: false, speech_rate: 'slow', language: 'en-US' }); // 'slow' is the profile default
    expect(body.link_owner).toBe('family');
    expect(body).toHaveProperty('family_first_name');
  });

  it('still opens the conversation when speech synthesis fails (greeting shown as text)', async () => {
    vi.spyOn(fakeSpeechClient, 'textToSpeech').mockRejectedValueOnce(new Error('tts down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { token } = await makeReadyParent();
    const res = await sessionPOST(bearerReq('http://localhost/api/talk/session', token));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.greeting_audio_url).toBeNull();
    expect(body.greeting).toContain('Robert');
  });
});

describe('POST /api/talk/message', () => {
  it('401s without a valid parent token', async () => {
    const res = await messagePOST(
      bearerReq('http://localhost/api/talk/message', null, { conversation_id: 'x', content: 'hi' }),
    );
    expect(res.status).toBe(401);
  });

  it('replies and records both turns for an open session', async () => {
    const { token } = await makeReadyParent();
    const opened = await sessionPOST(bearerReq('http://localhost/api/talk/session', token));
    const { conversation_id: conversationId } = await opened.json();

    const res = await messagePOST(
      bearerReq('http://localhost/api/talk/message', token, { conversation_id: conversationId, content: 'Hello Dearly' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversation_id).toBe(conversationId);
    expect(typeof body.reply).toBe('string');
    expect(body.reply.length).toBeGreaterThan(0);
  });

  it('400s empty message content', async () => {
    const { token } = await makeReadyParent();
    const opened = await sessionPOST(bearerReq('http://localhost/api/talk/session', token));
    const { conversation_id: conversationId } = await opened.json();

    const res = await messagePOST(
      bearerReq('http://localhost/api/talk/message', token, { conversation_id: conversationId, content: '   ' }),
    );
    expect(res.status).toBe(400);
  });

  it('regenerates a banned-output-violating reply once, and audit-logs the regeneration', async () => {
    const spy = vi
      .spyOn(fakeAiClient, 'companionReply')
      .mockResolvedValueOnce({ text: "I promise I won't tell your family what you said." })
      .mockResolvedValueOnce({ text: "I can't promise to keep secrets, but I'm glad to listen." });

    const { token } = await makeReadyParent();
    const opened = await sessionPOST(bearerReq('http://localhost/api/talk/session', token));
    const { conversation_id: conversationId } = await opened.json();

    const res = await messagePOST(
      bearerReq('http://localhost/api/talk/message', token, { conversation_id: conversationId, content: 'Can you keep a secret?' }),
    );
    const body = await res.json();
    expect(body.reply).toBe("I can't promise to keep secrets, but I'm glad to listen.");
    expect(spy).toHaveBeenCalledTimes(2);
    // The retry is told which rule the first draft broke.
    expect(spy.mock.calls[1][0].violations).toEqual(['secrecyPromise']);

    const { rows } = await q.query<{ action: string; meta: { violated: string[]; channel: string } }>(
      `SELECT action, meta FROM audit_log WHERE action LIKE 'banned_output_%'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('banned_output_regenerated');
    expect(rows[0].meta.violated).toContain('secrecyPromise');
    expect(rows[0].meta.channel).toBe('text');
  });

  it('falls back to the safe reply when the regenerated reply also violates, persists the redacted text, and audit-logs the violation', async () => {
    vi.spyOn(fakeAiClient, 'companionReply').mockResolvedValue({
      text: "I promise I won't tell your family what you said.",
    });

    const { token } = await makeReadyParent();
    const opened = await sessionPOST(bearerReq('http://localhost/api/talk/session', token));
    const { conversation_id: conversationId } = await opened.json();

    const res = await messagePOST(
      bearerReq('http://localhost/api/talk/message', token, { conversation_id: conversationId, content: 'Can you keep a secret?' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe(SAFE_FALLBACK_REPLY);

    const { rows } = await q.query<{ target_id: string; meta: { violated: string[] } }>(
      `SELECT action, target_id, meta FROM audit_log WHERE action = 'banned_output_redacted'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].target_id).toBe(conversationId);
    expect(rows[0].meta.violated).toContain('secrecyPromise');

    const turns = await q.query<{ role: string; content: string }>(
      `SELECT role, content FROM conversation_turns WHERE conversation_id = $1 ORDER BY created_at`,
      [conversationId],
    );
    const kindlyTurns = turns.rows.filter((t) => t.role === 'kindly');
    const latestDearlyTurn = kindlyTurns[kindlyTurns.length - 1]; // [0] is the session-open greeting
    expect(latestDearlyTurn.content).toBe(SAFE_FALLBACK_REPLY); // the persisted turn is the redacted text, never the raw violation
  });

  it('flags an elderspeak-only reply for review without redacting it', async () => {
    vi.spyOn(fakeAiClient, 'companionReply').mockResolvedValueOnce({
      text: 'Time for your nap now, sweetie pie!',
    });

    const { token } = await makeReadyParent();
    const opened = await sessionPOST(bearerReq('http://localhost/api/talk/session', token));
    const { conversation_id: conversationId } = await opened.json();

    const res = await messagePOST(
      bearerReq('http://localhost/api/talk/message', token, { conversation_id: conversationId, content: 'Hello' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe('Time for your nap now, sweetie pie!'); // not redacted

    const { rows } = await q.query<{ meta: { flaggedForReview: string[] } }>(
      `SELECT action, meta FROM audit_log WHERE action = 'banned_output_review_flag'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].meta.flaggedForReview).toContain('elderspeak');
  });
});

describe('POST /api/talk/session/end', () => {
  it('401s without a valid parent token', async () => {
    const res = await sessionEndPOST(
      bearerReq('http://localhost/api/talk/session/end', null, { conversation_id: 'x' }),
    );
    expect(res.status).toBe(401);
  });

  it('ends the session, runs summarize/extract jobs, and keeps the talk cookie so "Talk again" works', async () => {
    const { token } = await makeReadyParent();
    const opened = await sessionPOST(bearerReq('http://localhost/api/talk/session', token));
    const { conversation_id: conversationId } = await opened.json();

    const res = await sessionEndPOST(
      bearerReq('http://localhost/api/talk/session/end', token, { conversation_id: conversationId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversation_id).toBe(conversationId);
    expect(body.ended_at).toBeTruthy();
    expect(body.summarized).toBe(true);

    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).not.toMatch(new RegExp(`${PARENT_TOKEN_COOKIE}=;|Max-Age=0`, 'i'));

    // Talk again: a new session opens with the same credential.
    const again = await sessionPOST(bearerReq('http://localhost/api/talk/session', token));
    expect(again.status).toBe(201);
    expect((await again.json()).conversation_id).not.toBe(conversationId);
  });

  it('a revoked link is refused on the next request even though the cookie was kept', async () => {
    const { token, parentId } = await makeReadyParent();
    await q.query(`UPDATE parent_access_tokens SET revoked_at = now() WHERE parent_id = $1`, [parentId]);
    const res = await sessionPOST(bearerReq('http://localhost/api/talk/session', token));
    expect(res.status).toBe(401);
  });

  it('is idempotent — ending twice does not re-run the jobs', async () => {
    const { token } = await makeReadyParent();
    const opened = await sessionPOST(bearerReq('http://localhost/api/talk/session', token));
    const { conversation_id: conversationId } = await opened.json();

    await sessionEndPOST(bearerReq('http://localhost/api/talk/session/end', token, { conversation_id: conversationId }));
    const second = await sessionEndPOST(
      bearerReq('http://localhost/api/talk/session/end', token, { conversation_id: conversationId }),
    );
    const body = await second.json();
    expect(body.summarized).toBe(false); // already summarized on first end
  });
});
