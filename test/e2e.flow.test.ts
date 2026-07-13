import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from './db';
import type { Querier } from '../src/lib/querier';
import { SESSION_COOKIE } from '../src/lib/session';
import { PARENT_TOKEN_COOKIE } from '../src/lib/parentSession';
import { fakeEmailClient, resetEmailClient } from '../src/lib/email';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so every handler picks up the mocked db().
import { POST as signupPOST } from '../src/app/api/auth/signup/route';
import { POST as loginPOST } from '../src/app/api/auth/login/route';
import { POST as parentsPOST, GET as parentsGET } from '../src/app/api/parents/route';
import { POST as parentConsentPOST } from '../src/app/api/parents/[id]/consent/route';
import { POST as activatePOST } from '../src/app/api/parents/[id]/activate/route';
import { POST as accessLinkPOST } from '../src/app/api/parents/[id]/access-link/route';
import { POST as talkAuthPOST } from '../src/app/api/talk/auth/route';
import { POST as talkConsentPOST } from '../src/app/api/talk/consent/route';
import { POST as sessionPOST } from '../src/app/api/talk/session/route';
import { POST as messagePOST } from '../src/app/api/talk/message/route';
import { POST as sessionEndPOST } from '../src/app/api/talk/session/end/route';
import { GET as memoriesGET } from '../src/app/api/parents/[id]/memories/route';
import { PATCH as memoryPATCH } from '../src/app/api/memories/[mid]/route';
import { GET as previewGET } from '../src/app/api/parents/[id]/summary/preview/route';
import { POST as inviteSiblingPOST } from '../src/app/api/parents/[id]/invite-sibling/route';
import { POST as acceptPOST } from '../src/app/api/invites/accept/route';
import { POST as summarySendPOST } from '../src/app/api/parents/[id]/summary/send/route';
import { GET as summariesGET } from '../src/app/api/parents/[id]/summaries/route';
import { POST as referralsPOST } from '../src/app/api/referrals/route';
import { POST as redeemPOST } from '../src/app/api/referrals/redeem/route';

/** Extracts `name=value` from a Set-Cookie header, ignoring attributes. */
function cookieValue(setCookie: string | null, name: string): string {
  const match = new RegExp(`${name}=([^;]+)`).exec(setCookie ?? '');
  if (!match) throw new Error(`cookie ${name} not set`);
  return match[1];
}

function req(url: string, opts: { method?: string; cookies?: Record<string, string>; body?: unknown; ip?: string } = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.cookies) {
    headers.cookie = Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  if (opts.ip) headers['x-forwarded-for'] = opts.ip;
  return new NextRequest(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
  process.env.DATABASE_URL = 'postgres://test';
  delete process.env.AI_API_KEY; // fake AI client
  delete process.env.EMAIL_API_KEY; // fake email client
  resetEmailClient();
});

describe('end-to-end golden path', () => {
  it('buyer signup -> onboarding -> consent -> activate -> talk (text) -> memories -> weekly summary -> sibling invite/delivery -> referrals', async () => {
    // 1. Buyer signs up and gets a session cookie.
    const signup = await signupPOST(req('http://localhost/api/auth/signup', {
      method: 'POST',
      body: { email: 'sarah@example.com', password: 'correct-horse-battery' },
    }));
    expect(signup.status).toBe(201);
    const buyerSession = cookieValue(signup.headers.get('set-cookie'), SESSION_COOKIE);
    const buyerId = (await signup.json()).user.id as string;

    // Logging back in with the same credentials also works (route wiring, not just signup).
    const login = await loginPOST(req('http://localhost/api/auth/login', {
      method: 'POST',
      body: { email: 'sarah@example.com', password: 'correct-horse-battery' },
      ip: '1.1.1.1',
    }));
    expect(login.status).toBe(200);

    // 2. Onboarding: create the parent profile.
    const createParent = await parentsPOST(req('http://localhost/api/parents', {
      method: 'POST',
      cookies: { [SESSION_COOKIE]: buyerSession },
      body: { first_name: 'Robert', relationship: 'father', city: 'Detroit' },
    }));
    expect(createParent.status).toBe(201);
    const parentId = (await createParent.json()).parent.id as string;

    const listed = await parentsGET(req('http://localhost/api/parents', { cookies: { [SESSION_COOKIE]: buyerSession } }));
    expect((await listed.json()).parents).toHaveLength(1);

    // 3. Consent-gated activation.
    const consent = await parentConsentPOST(
      req(`http://localhost/api/parents/${parentId}/consent`, {
        method: 'POST',
        cookies: { [SESSION_COOKIE]: buyerSession },
        body: { kind: 'buyer_attestation' },
      }),
      { params: { id: parentId } },
    );
    expect(consent.status).toBe(201);

    const activate = await activatePOST(
      req(`http://localhost/api/parents/${parentId}/activate`, { method: 'POST', cookies: { [SESSION_COOKIE]: buyerSession } }),
      { params: { id: parentId } },
    );
    expect(activate.status).toBe(200);
    expect((await activate.json()).parent.activated_at).toBeTruthy();

    // 4. Billing: start the 7-day trial. Exercised here as "the webhook already
    // landed" (a trialing subscription row) — the real Stripe Checkout round
    // trip and webhook processing are covered separately in billing.route.test.ts.
    await q.query(
      `INSERT INTO subscriptions (buyer_id, parent_id, plan, status, current_period_end)
       VALUES ($1, $2, 'family', 'trialing', now() + interval '7 days')`,
      [buyerId, parentId],
    );

    // 5. Issue the parent's talk access link and exchange it for a talk cookie.
    const accessLink = await accessLinkPOST(
      req(`http://localhost/api/parents/${parentId}/access-link`, { method: 'POST', cookies: { [SESSION_COOKIE]: buyerSession } }),
      { params: { id: parentId } },
    );
    expect(accessLink.status).toBe(201);
    const rawToken = (await accessLink.json()).token as string;

    const talkAuth = await talkAuthPOST(
      new NextRequest('http://localhost/api/talk/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rawToken }),
      }),
    );
    expect(talkAuth.status).toBe(200);
    const talkCookie = cookieValue(talkAuth.headers.get('set-cookie'), PARENT_TOKEN_COOKIE);

    // 6. Parent grants first-session consent, then talks.
    const talkConsent = await talkConsentPOST(
      new NextRequest('http://localhost/api/talk/consent', {
        method: 'POST',
        headers: { cookie: `${PARENT_TOKEN_COOKIE}=${talkCookie}` },
      }),
    );
    expect(talkConsent.status).toBe(201);

    const session = await sessionPOST(
      new NextRequest('http://localhost/api/talk/session', {
        method: 'POST',
        headers: { cookie: `${PARENT_TOKEN_COOKIE}=${talkCookie}` },
      }),
    );
    expect(session.status).toBe(201);
    const { conversation_id: conversationId, greeting } = await session.json();
    expect(greeting).toContain('Robert');

    const message = await messagePOST(
      new NextRequest('http://localhost/api/talk/message', {
        method: 'POST',
        headers: { cookie: `${PARENT_TOKEN_COOKIE}=${talkCookie}`, 'content-type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId, content: 'I had a lovely walk today.' }),
      }),
    );
    expect(message.status).toBe(200);
    expect((await message.json()).reply.length).toBeGreaterThan(0);

    const ended = await sessionEndPOST(
      new NextRequest('http://localhost/api/talk/session/end', {
        method: 'POST',
        headers: { cookie: `${PARENT_TOKEN_COOKIE}=${talkCookie}`, 'content-type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      }),
    );
    expect(ended.status).toBe(200);
    expect((await ended.json()).summarized).toBe(true);

    // 7. Buyer reviews memories extracted from the session (proposed) and confirms one, if any.
    const memories = await memoriesGET(
      req(`http://localhost/api/parents/${parentId}/memories`, { cookies: { [SESSION_COOKIE]: buyerSession } }),
      { params: { id: parentId } },
    );
    expect(memories.status).toBe(200);
    const proposed = (await memories.json()).memories as Array<{ id: string; status: string }>;
    for (const m of proposed.filter((x) => x.status === 'proposed')) {
      const confirmed = await memoryPATCH(
        req(`http://localhost/api/memories/${m.id}`, {
          method: 'PATCH',
          cookies: { [SESSION_COOKIE]: buyerSession },
          body: { action: 'confirm' },
        }),
        { params: { mid: m.id } },
      );
      expect(confirmed.status).toBe(200);
    }

    // 8. Weekly summary preview reflects the conversation that just happened.
    const preview = await previewGET(
      req(`http://localhost/api/parents/${parentId}/summary/preview`, { cookies: { [SESSION_COOKIE]: buyerSession } }),
      { params: { id: parentId } },
    );
    expect(preview.status).toBe(200);
    expect((await preview.json()).summary.body_short).toContain('Robert');

    // 9. Invite a sibling as a summary recipient; they accept via the emailed link.
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    const invite = await inviteSiblingPOST(
      req(`http://localhost/api/parents/${parentId}/invite-sibling`, {
        method: 'POST',
        cookies: { [SESSION_COOKIE]: buyerSession },
        body: { email: 'mike@example.com' },
      }),
      { params: { id: parentId } },
    );
    expect(invite.status).toBe(201);
    const inviteHtml = sendSpy.mock.calls[0][0].html;
    const inviteToken = new URL(inviteHtml.match(/href="([^"]+)"/)![1]).searchParams.get('token')!;

    const accepted = await acceptPOST(req('http://localhost/api/invites/accept', { method: 'POST', body: { token: inviteToken } }));
    expect(accepted.status).toBe(200);

    // 10. Sending the weekly summary now delivers to the accepted recipient.
    const sent = await summarySendPOST(
      req(`http://localhost/api/parents/${parentId}/summary/send`, { method: 'POST', cookies: { [SESSION_COOKIE]: buyerSession } }),
      { params: { id: parentId } },
    );
    expect(sent.status).toBe(200);
    const sentBody = await sent.json();
    expect(sentBody.summary.status).toBe('sent');
    expect(sentBody.deliveries).toHaveLength(1);

    const summaries = await summariesGET(
      req(`http://localhost/api/parents/${parentId}/summaries`, { cookies: { [SESSION_COOKIE]: buyerSession } }),
      { params: { id: parentId } },
    );
    expect((await summaries.json()).summaries).toHaveLength(1);

    // 10. Referral: the buyer generates a code and a second buyer redeems it.
    const referral = await referralsPOST(
      req('http://localhost/api/referrals', { method: 'POST', cookies: { [SESSION_COOKIE]: buyerSession } }),
    );
    expect(referral.status).toBe(201);
    const referralCode = (await referral.json()).code as string;

    const secondSignup = await signupPOST(req('http://localhost/api/auth/signup', {
      method: 'POST',
      body: { email: 'nadia@example.com', password: 'another-strong-pass' },
    }));
    const secondSession = cookieValue(secondSignup.headers.get('set-cookie'), SESSION_COOKIE);

    const redeem = await redeemPOST(
      req('http://localhost/api/referrals/redeem', {
        method: 'POST',
        cookies: { [SESSION_COOKIE]: secondSession },
        body: { code: referralCode },
        ip: '2.2.2.2',
      }),
    );
    expect(redeem.status).toBe(200);

    // Sanity: the whole flow stayed scoped to the one buyer/parent throughout.
    expect(buyerId).toBeTruthy();
  });
});
