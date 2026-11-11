import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReferralCodeField } from '../src/components/ReferralCodeField';
import { AuthForm } from '../src/components/AuthForm';
import { normalizeReferralCode, readReferralCookie } from '../src/lib/referralCode';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${typeof input === 'string' ? input : input.toString()}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function clearRefCookie() {
  document.cookie = 'dearly_ref=; Max-Age=0; path=/';
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearRefCookie();
});

describe('referral code helpers', () => {
  it('normalizes only well-formed codes', () => {
    expect(normalizeReferralCode(' abcdefghjk ')).toBe('ABCDEFGHJK');
    expect(normalizeReferralCode('ABCDEFGHJ0')).toBeNull();
    expect(normalizeReferralCode('short')).toBeNull();
    expect(normalizeReferralCode(42)).toBeNull();
  });
  it('reads the ref cookie', () => {
    expect(readReferralCookie('a=1; dearly_ref=ABCDEFGHJK; b=2')).toBe('ABCDEFGHJK');
    expect(readReferralCookie('a=1')).toBeNull();
  });
});

describe('ReferralCodeField (onboarding checkout step)', () => {
  it('is prefilled from the ?ref= cookie and applies the code', async () => {
    document.cookie = 'dearly_ref=ABCDEFGHJK; path=/';
    const fetchMock = stubFetch({
      'GET /api/referrals': () => json({ code: null, redemptions: [], used_code: false }),
      'POST /api/referrals/redeem': () => json({ ok: true }),
    });
    render(<ReferralCodeField />);
    const input = (await screen.findByLabelText(/referral code/i)) as HTMLInputElement;
    expect(input.value).toBe('ABCDEFGHJK');
    fireEvent.click(screen.getByRole('button', { name: /apply code/i }));
    expect(await screen.findByText('Referral code applied')).toBeTruthy();
    const redeemCall = fetchMock.mock.calls.find(([u]) => u === '/api/referrals/redeem');
    expect(JSON.parse(String(redeemCall?.[1]?.body))).toEqual({ code: 'ABCDEFGHJK' });
  });

  it('shows the server message for a rejected code', async () => {
    stubFetch({
      'GET /api/referrals': () => json({ code: null, redemptions: [], used_code: false }),
      'POST /api/referrals/redeem': () =>
        json({ error: { code: 'precondition_failed', message: 'Referral codes are for new families only.' } }, 409),
    });
    render(<ReferralCodeField />);
    fireEvent.change(await screen.findByLabelText(/referral code/i), { target: { value: 'ABCDEFGHJK' } });
    fireEvent.click(screen.getByRole('button', { name: /apply code/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/new families only/i);
  });

  it('shows "applied" instead of the field when the buyer already used a code at signup', async () => {
    stubFetch({ 'GET /api/referrals': () => json({ code: null, redemptions: [], used_code: true }) });
    render(<ReferralCodeField />);
    expect(await screen.findByText('Referral code applied')).toBeTruthy();
    expect(screen.queryByLabelText(/referral code/i)).toBeNull();
  });
});

describe('AuthForm signup referral field', () => {
  it('prefills from the page ?ref= and sends referral_code with signup', async () => {
    const fetchMock = stubFetch({ 'POST /api/auth/signup': () => json({ ok: true, next: 'check_email' }, 202) });
    render(<AuthForm mode="signup" referralCode="abcdefghjk" />);
    expect((screen.getByLabelText(/referral code/i) as HTMLInputElement).value).toBe('ABCDEFGHJK');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await screen.findByText('Check your email');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      email: 'new@example.com',
      password: 'correct-horse',
      referral_code: 'ABCDEFGHJK',
    });
  });

  it('falls back to the ref cookie', () => {
    document.cookie = 'dearly_ref=ABCDEFGHJK; path=/';
    render(<AuthForm mode="signup" />);
    expect((screen.getByLabelText(/referral code/i) as HTMLInputElement).value).toBe('ABCDEFGHJK');
  });

  it('has no referral field on login', () => {
    render(<AuthForm mode="login" />);
    expect(screen.queryByLabelText(/referral code/i)).toBeNull();
  });
});
