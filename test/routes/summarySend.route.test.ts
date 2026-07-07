import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { consentRepo } from '../../src/lib/repos/consent';
import { signSession, SESSION_COOKIE } from '../../src/lib/session';
import { fakeEmailClient, resetEmailClient } from '../../src/lib/email';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

// Imported AFTER the mock so the handlers pick up the mocked db().
import { POST as inviteSiblingPOST } from '../../src/app/api/parents/[id]/invite-sibling/route';
import { POST as acceptPOST } from '../../src/app/api/invites/accept/route';
import { POST as summarySendPOST } from '../../src/app/api/parents/[id]/summary/send/route';

async function makeBuyer(email: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1) RETURNING id`,
    [email],
  );
  return rows[0].id;
}

function buyerReq(url: string, buyerId: string | null, body?: unknown): NextRequest {
  const headers: Record<string, string> = {};
  if (buyerId) headers.cookie = `${SESSION_COOKIE}=${signSession(buyerId)}`;
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
  delete process.env.EMAIL_API_KEY; // force the fake client
  resetEmailClient();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/parents/:id/invite-sibling', () => {
  it('401s without a buyer session', async () => {
    const req = new NextRequest('http://localhost/api/parents/x/invite-sibling', {
      method: 'POST',
      body: JSON.stringify({ email: 'sib@example.com' }),
    });
    const res = await inviteSiblingPOST(req, { params: { id: 'x' } });
    expect(res.status).toBe(401);
  });

  it('404s inviting to a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer('owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer('attacker@example.com');

    const res = await inviteSiblingPOST(
      buyerReq(`http://localhost/api/parents/${parent.id}/invite-sibling`, attacker, { email: 'sib@example.com' }),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(404);
  });

  it('creates a pending consent and emails the accept link', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    const buyerId = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });

    const res = await inviteSiblingPOST(
      buyerReq(`http://localhost/api/parents/${parent.id}/invite-sibling`, buyerId, { email: 'sib@example.com' }),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('pending');

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = sendSpy.mock.calls[0][0];
    expect(sent.to).toBe('sib@example.com');
    expect(sent.subject).toContain('Robert');
    expect(sent.html).toContain('/invite/accept?token=');

    // The raw invite token is never returned to the buyer.
    expect(JSON.stringify(body)).not.toContain('token');
  });

  it('429s once the per-buyer invite rate limit is exceeded', async () => {
    const buyerId = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });

    let last;
    for (let i = 0; i < 21; i++) {
      last = await inviteSiblingPOST(
        buyerReq(`http://localhost/api/parents/${parent.id}/invite-sibling`, buyerId, { email: `sib${i}@example.com` }),
        { params: { id: parent.id } },
      );
    }
    expect(last!.status).toBe(429);
  });
});

describe('POST /api/invites/accept', () => {
  it('404s an unknown/invalid token', async () => {
    const req = new NextRequest('http://localhost/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token: 'not-a-real-token' }),
    });
    const res = await acceptPOST(req);
    expect(res.status).toBe(404);
  });

  it('accepts a pending invite by its raw token', async () => {
    const buyerId = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });
    const { inviteToken } = await consentRepo.recordRecipientInvite(q, {
      parentId: parent.id,
      grantedBy: buyerId,
      recipientEmail: 'sib@example.com',
    });

    const res = await acceptPOST(
      new NextRequest('http://localhost/api/invites/accept', {
        method: 'POST',
        body: JSON.stringify({ token: inviteToken }),
      }),
    );
    expect(res.status).toBe(200);

    const recipients = await consentRepo.listRecipients(q, parent.id);
    expect(recipients[0].status).toBe('accepted');
  });
});

describe('POST /api/parents/:id/summary/send (email delivery, end-to-end)', () => {
  it('401s without a buyer session', async () => {
    const req = new NextRequest('http://localhost/api/parents/x/summary/send', { method: 'POST' });
    const res = await summarySendPOST(req, { params: { id: 'x' } });
    expect(res.status).toBe(401);
  });

  it('404s sending for a parent owned by another buyer (isolation)', async () => {
    const owner = await makeBuyer('owner@example.com');
    const parent = await parentRepo.create(q, { buyerId: owner, firstName: 'Robert', relationship: 'father' });
    const attacker = await makeBuyer('attacker@example.com');

    const res = await summarySendPOST(
      buyerReq(`http://localhost/api/parents/${parent.id}/summary/send`, attacker),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(404);
  });

  it('409s with no accepted recipients', async () => {
    const buyerId = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });

    const res = await summarySendPOST(
      buyerReq(`http://localhost/api/parents/${parent.id}/summary/send`, buyerId),
      { params: { id: parent.id } },
    );
    expect(res.status).toBe(409);
  });

  it('sends to a recipient only after they click the emailed accept link', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    const buyerId = await makeBuyer('sarah@example.com');
    const parent = await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' });

    await inviteSiblingPOST(
      buyerReq(`http://localhost/api/parents/${parent.id}/invite-sibling`, buyerId, { email: 'sib@example.com' }),
      { params: { id: parent.id } },
    );

    // Not yet accepted — send is still blocked.
    const tooSoon = await summarySendPOST(
      buyerReq(`http://localhost/api/parents/${parent.id}/summary/send`, buyerId),
      { params: { id: parent.id } },
    );
    expect(tooSoon.status).toBe(409);

    // Recover the accept link exactly as the recipient would from the email body.
    const { html } = sendSpy.mock.calls[0][0];
    const inviteToken = new URL(html.match(/href="([^"]+)"/)![1]).searchParams.get('token')!;
    const accepted = await acceptPOST(
      new NextRequest('http://localhost/api/invites/accept', {
        method: 'POST',
        body: JSON.stringify({ token: inviteToken }),
      }),
    );
    expect(accepted.status).toBe(200);

    const sent = await summarySendPOST(
      buyerReq(`http://localhost/api/parents/${parent.id}/summary/send`, buyerId),
      { params: { id: parent.id } },
    );
    expect(sent.status).toBe(200);
    const body = await sent.json();
    expect(body.deliveries).toHaveLength(1);
    expect(body.summary.status).toBe('sent');
  });
});
