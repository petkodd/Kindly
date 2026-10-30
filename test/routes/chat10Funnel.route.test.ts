import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeTestDb } from '../db';
import type { Querier } from '../../src/lib/querier';
import { parentRepo } from '../../src/lib/repos/parent';
import { accessTokenRepo } from '../../src/lib/repos/accessToken';
import { consentRepo } from '../../src/lib/repos/consent';
import { subscriptionRepo } from '../../src/lib/repos/subscription';
import { fakeEmailClient, resetEmailClient } from '../../src/lib/email';
import { makeBuyer, authedReq } from './helpers';

let q: Querier;
vi.mock('@/lib/db', () => ({ db: () => q }));

const portalCreate = vi.fn();
vi.mock('@/lib/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing')>();
  return { ...actual, getStripeClient: () => ({ billingPortal: { sessions: { create: portalCreate } } }) };
});

import { POST as portalPOST } from '../../src/app/api/billing/portal/route';
import { GET as alertGET, PUT as alertPUT } from '../../src/app/api/me/alert-contact/route';
import { GET as invitePreviewGET, POST as inviteAcceptPOST } from '../../src/app/api/invites/accept/route';
import { GET as linkStatusGET, POST as linkPOST } from '../../src/app/api/parents/[id]/access-link/route';
import { POST as linkRevokePOST } from '../../src/app/api/parents/[id]/access-link/revoke/route';
import { POST as linkEmailPOST } from '../../src/app/api/parents/[id]/access-link/email/route';
import { POST as signupPOST } from '../../src/app/api/auth/signup/route';
import { POST as talkAuthPOST } from '../../src/app/api/talk/auth/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, uid: string | null, body?: unknown) =>
  authedReq(url, uid, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

let buyerId: string;
let parentId: string;

beforeEach(async () => {
  q = makeTestDb();
  process.env.SESSION_SECRET = 'test-secret-value';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://dearly.example.com';
  delete process.env.EMAIL_API_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  resetEmailClient();
  portalCreate.mockReset();
  buyerId = await makeBuyer(q, 'sarah@example.com');
  await q.query(`UPDATE users SET full_name = 'Sarah Lee' WHERE id = $1`, [buyerId]);
  parentId = (await parentRepo.create(q, { buyerId, firstName: 'Robert', relationship: 'father' })).id;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function addStripeSub(customer: string) {
  await subscriptionRepo.upsertFromStripeSubscription(q, {
    id: `sub_${customer}`,
    customer,
    status: 'trialing',
    current_period_end: Math.floor(Date.now() / 1000) + 7 * 86400,
    metadata: { buyer_id: buyerId, parent_id: parentId },
    billingInterval: 'month',
  });
}

describe('POST /api/billing/portal', () => {
  it('401s without a session', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect((await portalPOST(post('http://localhost/api/billing/portal', null))).status).toBe(401);
  });

  it('503s when Stripe is not configured, without calling Stripe', async () => {
    const res = await portalPOST(post('http://localhost/api/billing/portal', buyerId));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('billing_not_configured');
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it('404s no_billing_account when the buyer has no Stripe customer (e.g. beta only)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    const res = await portalPOST(post('http://localhost/api/billing/portal', buyerId));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('no_billing_account');
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it('opens a portal session for THIS buyer’s own Stripe customer and returns its url', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    await addStripeSub('cus_sarah');
    portalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session/test_123' });
    const res = await portalPOST(post('http://localhost/api/billing/portal', buyerId, { customer: 'cus_someone_else' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://billing.stripe.com/session/test_123' });
    expect(portalCreate).toHaveBeenCalledWith({
      customer: 'cus_sarah',
      return_url: 'https://dearly.example.com/app/account',
    });
  });

  it('another buyer never gets this buyer’s customer', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    await addStripeSub('cus_sarah');
    const other = await makeBuyer(q, 'other@example.com');
    const res = await portalPOST(post('http://localhost/api/billing/portal', other));
    expect(res.status).toBe(404);
    expect(portalCreate).not.toHaveBeenCalled();
  });

  it('a Stripe failure is a friendly 503, not a leaked error', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    await addStripeSub('cus_sarah');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    portalCreate.mockRejectedValue(Object.assign(new Error('No such customer: cus_sarah (secret detail)'), { name: 'StripeInvalidRequestError' }));
    const res = await portalPOST(post('http://localhost/api/billing/portal', buyerId));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
  });

  it('refuses a cross-site request (CSRF) even with a valid session', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    await addStripeSub('cus_sarah');
    const res = await portalPOST(
      authedReq('http://localhost/api/billing/portal', buyerId, { method: 'POST', headers: { origin: 'https://evil.example' } }),
    );
    expect(res.status).toBe(401);
    expect(portalCreate).not.toHaveBeenCalled();
  });
});

describe('/api/me/alert-contact', () => {
  const put = (uid: string | null, body: unknown) =>
    alertPUT(authedReq('http://localhost/api/me/alert-contact', uid, { method: 'PUT', body: JSON.stringify(body) }));

  it('401s without a session', async () => {
    expect((await alertGET(authedReq('http://localhost/api/me/alert-contact', null))).status).toBe(401);
    expect((await put(null, { phone: null, sms_consent: false })).status).toBe(401);
  });

  it('saves a US number as E.164 with SMS consent, and reads it back', async () => {
    const res = await put(buyerId, { phone: '(312) 555-0142', sms_consent: true });
    expect(res.status).toBe(200);
    const { alert_contact: c } = await res.json();
    expect(c.alert_phone).toBe('+13125550142');
    expect(c.sms_alert_consent_at).toBeTruthy();
    const read = await (await alertGET(authedReq('http://localhost/api/me/alert-contact', buyerId))).json();
    expect(read.alert_contact.alert_phone).toBe('+13125550142');
  });

  it('a number without consent is saved with no SMS consent (email-only alerts)', async () => {
    const { alert_contact: c } = await (await put(buyerId, { phone: '312-555-0142', sms_consent: false })).json();
    expect(c.alert_phone).toBe('+13125550142');
    expect(c.sms_alert_consent_at).toBeNull();
  });

  it('rejects non-US and invalid numbers, and a missing consent flag', async () => {
    for (const phone of ['+442071838750', '12345', '(012) 555-0142', '(312) 155-0142', 'call me']) {
      const res = await put(buyerId, { phone, sms_consent: true });
      expect(res.status, phone).toBe(400);
    }
    expect((await put(buyerId, { phone: '3125550142' })).status).toBe(400);
  });

  it('clearing the number clears the consent', async () => {
    await put(buyerId, { phone: '3125550142', sms_consent: true });
    const { alert_contact: c } = await (await put(buyerId, { phone: '', sms_consent: false })).json();
    expect(c).toEqual({ alert_phone: null, sms_alert_consent_at: null });
  });
});

describe('/api/invites/accept — preview before accepting', () => {
  async function invite() {
    return (await consentRepo.recordRecipientInvite(q, { parentId, grantedBy: buyerId, recipientEmail: 'sib@example.com' }))
      .inviteToken;
  }
  const preview = (token: string) =>
    invitePreviewGET(new NextRequest(`http://localhost/api/invites/accept?token=${encodeURIComponent(token)}`, {
      headers: { 'x-forwarded-for': '9.9.9.9' },
    }));

  it('GET shows inviter and parent first names and does NOT accept', async () => {
    const token = await invite();
    const res = await preview(token);
    expect(res.status).toBe(200);
    const { invite: inv } = await res.json();
    expect(inv).toEqual({ inviter_first_name: 'Sarah', parent_first_name: 'Robert', status: 'pending' });
    expect(JSON.stringify(inv)).not.toContain('sib@example.com');
    const [recipient] = await consentRepo.listRecipients(q, parentId);
    expect(recipient.status).toBe('pending');
    expect(await consentRepo.listAcceptedRecipients(q, parentId)).toHaveLength(0);
  });

  it('POST accepts; a later preview reports accepted', async () => {
    const token = await invite();
    const res = await inviteAcceptPOST(
      new NextRequest('http://localhost/api/invites/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
        body: JSON.stringify({ token }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await (await preview(token)).json()).invite.status).toBe('accepted');
  });

  it('unknown token → 404; expired → 410; revoked → 404; missing → 400', async () => {
    expect((await preview('nope')).status).toBe(404);
    const token = await invite();
    await q.query(`UPDATE consents SET granted_at = now() - interval '20 days' WHERE kind = 'summary_recipient'`);
    expect((await preview(token)).status).toBe(410);
    await q.query(`UPDATE consents SET revoked_at = now() WHERE kind = 'summary_recipient'`);
    expect((await preview(token)).status).toBe(404);
    expect((await invitePreviewGET(new NextRequest('http://localhost/api/invites/accept'))).status).toBe(400);
  });

  it('a deleted parent’s invite is not valid', async () => {
    const token = await invite();
    await q.query(`UPDATE parents SET deleted_at = now() WHERE id = $1`, [parentId]);
    expect((await preview(token)).status).toBe(404);
  });
});

describe('parent talk link: status, revoke + re-issue, email it to me', () => {
  const link = (uid: string | null, id = parentId) =>
    linkPOST(post(`http://localhost/api/parents/${id}/access-link`, uid), ctx(id));
  const status = async (uid: string | null, id = parentId) =>
    linkStatusGET(authedReq(`http://localhost/api/parents/${id}/access-link`, uid), ctx(id));
  const talkAuth = (token: string) =>
    talkAuthPOST(new NextRequest('http://localhost/api/talk/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '7.7.7.7' },
      body: JSON.stringify({ token }),
    }));

  it('status reports no link, then an active one (never the token)', async () => {
    expect(await (await status(buyerId)).json()).toEqual({ active: false, created_at: null, expires_at: null });
    await link(buyerId);
    const s = await (await status(buyerId)).json();
    expect(s.active).toBe(true);
    expect(s.created_at).toBeTruthy();
    expect(s.expires_at).toBeTruthy();
    expect(Object.keys(s).sort()).toEqual(['active', 'created_at', 'expires_at']);
  });

  it('status is owner-only', async () => {
    const other = await makeBuyer(q, 'other@example.com');
    expect((await status(other)).status).toBe(404);
    expect((await status(null)).status).toBe(401);
  });

  it('revoke → old link fails; re-issue → new link works, old still fails', async () => {
    const { token: first } = await (await link(buyerId)).json();
    expect(await accessTokenRepo.resolveParentId(q, first)).toBe(parentId);
    await linkRevokePOST(post(`http://localhost/api/parents/${parentId}/access-link/revoke`, buyerId), ctx(parentId));
    expect((await (await status(buyerId)).json()).active).toBe(false);
    await expect(accessTokenRepo.resolveParentId(q, first)).rejects.toThrow();
    const { token: second } = await (await link(buyerId)).json();
    expect(await accessTokenRepo.resolveParentId(q, second)).toBe(parentId);
    await expect(accessTokenRepo.resolveParentId(q, first)).rejects.toThrow();
    expect((await talkAuth(first)).status).toBe(401);
  });

  it('email it to me: sends the link to the buyer’s own address only', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    const { token } = await (await link(buyerId)).json();
    const res = await linkEmailPOST(
      post(`http://localhost/api/parents/${parentId}/access-link/email`, buyerId, { token, to: 'attacker@example.com' }),
      ctx(parentId),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).sent_to).toBe('sarah@example.com');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const mail = sendSpy.mock.calls[0][0];
    expect(mail.to).toBe('sarah@example.com');
    expect(mail.subject).toBe("Robert's Dearly talk link");
    expect(mail.text).toContain(`https://dearly.example.com/app/talk?token=${token}`);
  });

  it('email it to me refuses a revoked token or another parent’s token', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    const { token } = await (await link(buyerId)).json();
    await linkRevokePOST(post(`http://localhost/api/parents/${parentId}/access-link/revoke`, buyerId), ctx(parentId));
    const res = await linkEmailPOST(post(`http://localhost/api/parents/${parentId}/access-link/email`, buyerId, { token }), ctx(parentId));
    expect(res.status).toBe(400);

    const otherParent = (await parentRepo.create(q, { buyerId, firstName: 'June', relationship: 'mother' })).id;
    const { token: juneToken } = await (await link(buyerId, otherParent)).json();
    const res2 = await linkEmailPOST(
      post(`http://localhost/api/parents/${parentId}/access-link/email`, buyerId, { token: juneToken }),
      ctx(parentId),
    );
    expect(res2.status).toBe(400);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('email it to me is owner-only and rate limited', async () => {
    const { token } = await (await link(buyerId)).json();
    const other = await makeBuyer(q, 'other@example.com');
    expect(
      (await linkEmailPOST(post(`http://localhost/api/parents/${parentId}/access-link/email`, other, { token }), ctx(parentId))).status,
    ).toBe(404);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await linkEmailPOST(post(`http://localhost/api/parents/${parentId}/access-link/email`, buyerId, { token }), ctx(parentId))).status,
      );
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});

describe('signup carries next through the confirmation link', () => {
  const signup = (body: unknown) =>
    signupPOST(new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify(body),
    }));

  it('a safe next is added to the verify link', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    await signup({ email: 'new@example.com', password: 'correct-horse', next: '/app/onboarding?interval=month' });
    const href = sendSpy.mock.calls[0][0].html.match(/href="([^"]+)"/)![1];
    const url = new URL(href);
    expect(url.pathname).toBe('/login/verify');
    expect(url.searchParams.get('token')).toBeTruthy();
    expect(url.searchParams.get('next')).toBe('/app/onboarding?interval=month');
  });

  it('an unsafe next is dropped', async () => {
    const sendSpy = vi.spyOn(fakeEmailClient, 'send');
    await signup({ email: 'new2@example.com', password: 'correct-horse', next: 'https://evil.example/app' });
    const href = sendSpy.mock.calls[0][0].html.match(/href="([^"]+)"/)![1];
    expect(new URL(href).searchParams.get('next')).toBeNull();
  });
});
