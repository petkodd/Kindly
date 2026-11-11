import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();
let pathname = '/';
// Stable across renders, like the real App Router (effects key off it).
const router = { push, replace, refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => searchParams,
  usePathname: () => pathname,
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import OnboardingPage from '../src/app/(app)/app/onboarding/page';
import AccountPage from '../src/app/(app)/app/account/page';
import { ParentTalkLinkSection, instructionCardHtml } from '../src/components/ParentTalkLinkSection';
import { MobileMenu } from '../src/components/MobileMenu';
import { AuthForm } from '../src/components/AuthForm';
import { MagicLinkVerify } from '../src/components/MagicLinkVerify';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;
function stubFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const bodyOf = (fetchMock: ReturnType<typeof stubFetch>, key: string) => {
  const call = fetchMock.mock.calls.find((c) => `${((c[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase()} ${String(c[0])}` === key);
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
};

beforeEach(() => {
  searchParams = new URLSearchParams();
  pathname = '/';
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  push.mockReset();
  replace.mockReset();
});

const ROBERT = { id: 'p1', first_name: 'Robert', relationship: 'father', activated_at: null };
const NO_ALERTS = () => json({ alert_contact: { alert_phone: null, sms_alert_consent_at: null } });

describe('Onboarding (chat 10)', () => {
  it('labels: capitalised relationship options under "They are your…"', async () => {
    stubFetch({ 'GET /api/parents': () => json({ parents: [] }), 'GET /api/me': () => json({ account: { full_name: null } }) });
    render(<OnboardingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /someone else/i }));
    const select = (await screen.findByLabelText('They are your…')) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Mother', 'Father', 'Grandparent', 'Aunt', 'Uncle', 'Other family member',
    ]);
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['mother', 'father', 'grandparent', 'aunt', 'uncle', 'other']);
  });

  it('memory step shows how the memories are stored', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [] }),
      'GET /api/me': () => json({ account: { full_name: null } }),
      'POST /api/parents': () => json({ parent: ROBERT }, 201),
    });
    render(<OnboardingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /someone else/i }));
    fireEvent.change(await screen.findByLabelText(/their first name/i), { target: { value: 'Robert' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    const note = await screen.findByRole('note');
    expect(note.textContent).toMatch(/stored privately in Robert’s Dearly profile/);
    expect(note.textContent).toMatch(/family can see what it remembers/);
    expect(note.textContent).toMatch(/don’t add medical details/i);
  });

  it('a 401 from the resume check clears the session and goes to signup with next (no dead end)', async () => {
    window.history.replaceState({}, '', '/app/onboarding');
    const fetchMock = stubFetch({
      'GET /api/parents': () => json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, 401),
      'GET /api/me': () => json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, 401),
      'POST /api/auth/logout': () => new Response(null, { status: 204 }),
    });
    render(<OnboardingPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/signup?next=%2Fapp%2Fonboarding'));
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/auth/logout')).toBe(true);
    expect(screen.queryByText(/who is this for/i)).toBeNull();
    window.history.replaceState({}, '', '/');
  });

  async function toAlertsStep(extra: Record<string, Handler> = {}) {
    searchParams = new URLSearchParams({ billing: 'success', parent_id: 'p1' });
    const fetchMock = stubFetch({
      'GET /api/me': () => json({ account: { full_name: 'Sarah' } }),
      'GET /api/parents/p1': () => json({ parent: ROBERT }),
      'POST /api/parents/p1/activate': () => json({ parent: { ...ROBERT, activated_at: '2026-10-30T00:00:00Z' } }),
      'GET /api/me/alert-contact': NO_ALERTS,
      ...extra,
    });
    render(<OnboardingPage />);
    expect(await screen.findByRole('heading', { name: 'Emergency alerts' })).toBeTruthy();
    return fetchMock;
  }

  it('Emergency alerts step: D2 copy, unticked TCPA consent, step 6 of 7', async () => {
    await toAlertsStep();
    expect(screen.getByText(/If Robert says something that sounds like an emergency, we’ll text and email you right away\./)).toBeTruthy();
    expect(screen.getByText('Step 6 of 7')).toBeTruthy();
    const box = screen.getByRole('checkbox') as HTMLInputElement;
    expect(box.checked).toBe(false);
    const consent = box.closest('label')!.textContent!;
    expect(consent).toMatch(/Reply STOP to opt out/);
    expect(consent).toMatch(/Message and data rates may apply/);
    expect(consent).toMatch(/at most about one every 30 minutes/);
  });

  it('saves the number as E.164 with consent, then continues to the talk-link step', async () => {
    const fetchMock = await toAlertsStep({
      'PUT /api/me/alert-contact': (init) => {
        const b = JSON.parse(String(init?.body));
        return json({ alert_contact: { alert_phone: b.phone, sms_alert_consent_at: b.sms_consent ? '2026-10-30T00:00:00Z' : null } });
      },
    });
    fireEvent.change(screen.getByLabelText(/your mobile number/i), { target: { value: '(312) 555-0142' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(await screen.findByText(/Robert is all set/)).toBeTruthy();
    expect(bodyOf(fetchMock, 'PUT /api/me/alert-contact')).toEqual({ phone: '+13125550142', sms_consent: true });
  });

  it('rejects an invalid number client-side without saving', async () => {
    const fetchMock = await toAlertsStep();
    fireEvent.change(screen.getByLabelText(/your mobile number/i), { target: { value: '555-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/US mobile number/);
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'PUT')).toBe(false);
  });

  it('skipping warns that alerts go by email only; "Done" goes to the family summary', async () => {
    await toAlertsStep();
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(screen.getByRole('alert').textContent).toMatch(/by email only/);
    fireEvent.click(screen.getByRole('button', { name: /Skip — email alerts only/ }));
    expect(await screen.findByText(/Robert is all set/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(push).toHaveBeenCalledWith('/app/family-summary');
  });
});

describe('ParentTalkLinkSection', () => {
  function routes(state: { active: boolean }, extra: Record<string, Handler> = {}) {
    return {
      'GET /api/parents/p1/access-link': () =>
        json(state.active
          ? { active: true, created_at: '2026-10-01T00:00:00Z', expires_at: '2026-12-30T00:00:00Z' }
          : { active: false, created_at: null, expires_at: null }),
      ...extra,
    };
  }

  it('creates a link, then copy / email it to me / print', async () => {
    const state = { active: false };
    const fetchMock = stubFetch(routes(state, {
      'POST /api/parents/p1/access-link': () => { state.active = true; return json({ token: 'tok_new', id: 'l1' }, 201); },
      'POST /api/parents/p1/access-link/email': () => json({ ok: true, sent_to: 'sarah@example.com' }),
    }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText } });
    render(<ParentTalkLinkSection parentId="p1" firstName="Robert" />);
    expect(await screen.findByText('There’s no active link right now.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make a talk link' }));
    const url = await screen.findByTestId('talk-url');
    expect(url.textContent).toMatch(/^https?:\/\/.+\/app\/talk\?token=tok_new$/);
    expect(await screen.findByText(/A link is active\./)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url.textContent));

    fireEvent.click(screen.getByRole('button', { name: 'Email it to me' }));
    expect(await screen.findByText('Sent to sarah@example.com.')).toBeTruthy();
    expect(bodyOf(fetchMock, 'POST /api/parents/p1/access-link/email')).toEqual({ token: 'tok_new' });

    const doc = { write: vi.fn(), close: vi.fn() };
    const win = { document: doc, focus: vi.fn(), print: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    fireEvent.click(screen.getByRole('button', { name: 'Print instruction card' }));
    expect(doc.write.mock.calls[0][0]).toContain('/app/talk?token=tok_new');
    expect(win.print).toHaveBeenCalled();
  });

  it('re-issuing an active link asks first and says the old one stops working', async () => {
    const state = { active: true };
    stubFetch(routes(state, { 'POST /api/parents/p1/access-link': () => json({ token: 'tok2', id: 'l2' }, 201) }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ParentTalkLinkSection parentId="p1" firstName="Robert" />);
    expect(await screen.findByText(/we only ever show a link once/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make a new link' }));
    expect(confirm.mock.calls[0][0]).toMatch(/current link will stop working/);
    expect(await screen.findByText('New link made. The old link no longer works.')).toBeTruthy();
  });

  it('turning off the link revokes it', async () => {
    const state = { active: true };
    const fetchMock = stubFetch(routes(state, {
      'POST /api/parents/p1/access-link/revoke': () => { state.active = false; return json({ ok: true }); },
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ParentTalkLinkSection parentId="p1" firstName="Robert" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off link' }));
    expect(await screen.findByText('There’s no active link right now.')).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/parents/p1/access-link/revoke')).toBe(true);
  });

  it('declining the confirm does nothing', async () => {
    const fetchMock = stubFetch(routes({ active: true }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ParentTalkLinkSection parentId="p1" firstName="Robert" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make a new link' }));
    expect(fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
  });

  it('the printable card escapes names and is large type', () => {
    const html = instructionCardHtml('<b>Bob</b>', 'https://x.example/app/talk?token=a&b');
    expect(html).toContain('&lt;b&gt;Bob&lt;/b&gt;');
    expect(html).not.toContain('<b>Bob</b>');
    expect(html).toContain('token=a&amp;b');
    expect(html).toMatch(/font-size:28px/);
    expect(html).toMatch(/AI companion — a computer, not a person/);
  });
});

describe('MobileMenu', () => {
  const items = [{ label: 'How it works', href: '/how-it-works' }, { label: 'Pricing', href: '/pricing' }];

  it('is a disclosure button with aria-expanded that traps focus and closes on Escape', () => {
    render(<MobileMenu items={items} ctaHref="/signup?next=%2Fapp%2Fonboarding" ctaLabel="Set up the gift" />);
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
    const links = within(panel).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/how-it-works', '/pricing', '/signup?next=%2Fapp%2Fonboarding']);
    expect(document.activeElement).toBe(links[0]);

    // Tab from the last link wraps to the toggle button; Shift+Tab from the button wraps to the last link.
    links[2].focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(button);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(links[2]);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
    expect(screen.queryByRole('link', { name: 'Pricing' })).toBeNull();
  });
});

describe('Auth next handling', () => {
  it('signup sends next so the confirmation link returns to onboarding; links keep next', async () => {
    const fetchMock = stubFetch({ 'POST /api/auth/signup': () => json({ ok: true, next: 'check_email' }, 202) });
    render(<AuthForm mode="signup" next="/app/onboarding?interval=month" />);
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/login?next=%2Fapp%2Fonboarding%3Finterval%3Dmonth',
    );
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sarah@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText('Check your email')).toBeTruthy();
    expect(bodyOf(fetchMock, 'POST /api/auth/signup')).toEqual({
      email: 'sarah@example.com', password: 'longenough', next: '/app/onboarding?interval=month',
    });
  });

  it('login goes to a safe next; an unsafe next is ignored', async () => {
    stubFetch({ 'POST /api/auth/login': () => json({ ok: true }) });
    render(<AuthForm mode="login" next="/app/memories" />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sarah@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/memories'));
    cleanup();
    push.mockReset();
    stubFetch({
      'POST /api/auth/login': () => json({ ok: true }),
      'GET /api/parents': () => json({ parents: [] }),
    });
    render(<AuthForm mode="login" next="https://evil.example" />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'sarah@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longenough' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/onboarding'));
  });

  it('the confirmation link lands on next after verifying', async () => {
    searchParams = new URLSearchParams({ token: 't1', next: '/app/onboarding' });
    stubFetch({ 'POST /api/auth/magic/verify': () => json({ ok: true }) });
    render(<MagicLinkVerify />);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/onboarding'));
  });
});

describe('Account page (chat 10)', () => {
  function accountRoutes(extra: Record<string, Handler> = {}, verified = false) {
    return {
      'GET /api/me': () => json({ account: { id: 'u1', email: 'sarah@example.com', full_name: 'Sarah', is_admin: false,
        created_at: '2026-10-01', email_verified_at: verified ? '2026-10-02T00:00:00Z' : null } }),
      'GET /api/me/alert-contact': NO_ALERTS,
      'GET /api/parents': () => json({ parents: [{ id: 'p1', first_name: 'Robert', relationship: 'father' }] }),
      ...extra,
    };
  }

  it('shows email status with a resend button when unconfirmed', async () => {
    stubFetch(accountRoutes({ 'POST /api/auth/verify-email/resend': () => json({ ok: true }) }));
    render(<AccountPage />);
    expect(await screen.findByText('Not confirmed yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resend link' }));
    expect(await screen.findByText('Sent. Check sarah@example.com for the link.')).toBeTruthy();
  });

  it('shows Confirmed and no resend button once verified', async () => {
    stubFetch(accountRoutes({}, true));
    render(<AccountPage />);
    expect(await screen.findByText('Confirmed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resend link' })).toBeNull();
  });

  it('Manage billing opens the Stripe portal url; errors show inline', async () => {
    stubFetch(accountRoutes({
      'POST /api/billing/portal': () => json({ error: { code: 'no_billing_account', message: 'There’s no card on file yet.' } }, 404),
    }));
    render(<AccountPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage billing' }));
    expect((await screen.findByRole('alert')).textContent).toBe('There’s no card on file yet.');
  });

  it('delete parent: lists exactly what is deleted and that the subscription is canceled', async () => {
    const fetchMock = stubFetch(accountRoutes({ 'DELETE /api/parents/p1': () => new Response(null, { status: 202 }) }));
    render(<AccountPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Robert’s profile' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toMatch(/everything Dearly remembers about Robert/);
    expect(dialog.textContent).toMatch(/conversations and weekly summaries/);
    expect(dialog.textContent).toMatch(/talk link \(it stops working immediately\)/);
    expect(dialog.textContent).toMatch(/subscription for Robert is canceled/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete Robert’s profile' }));
    expect(await screen.findByText(/Robert’s profile was deleted/)).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/parents/p1' && (c[1] as RequestInit).method === 'DELETE')).toBe(true);
  });

  it('delete account: confirmation lists what is deleted; a failure is shown, not swallowed', async () => {
    stubFetch(accountRoutes({
      'DELETE /api/me': () => json({ error: { code: 'billing_unavailable', message: 'We couldn’t reach our billing provider. Nothing was deleted.' } }, 503),
    }));
    render(<AccountPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete my account' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete your account?' });
    expect(dialog.textContent).toMatch(/every parent profile, with their memories, conversations and weekly summaries/);
    expect(dialog.textContent).toMatch(/Every subscription you pay for is canceled/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete my account' }));
    expect((await screen.findByText(/Nothing was deleted/)).textContent).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sign out failure shows a message instead of throwing', async () => {
    stubFetch(accountRoutes({ 'POST /api/auth/logout': () => json({ error: { code: 'x', message: 'Network down.' } }, 500) }));
    render(<AccountPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Network down.')).toBeTruthy();
  });

  it('Download my data fetches the export and reports rate limits inline', async () => {
    stubFetch(accountRoutes({
      'GET /api/me/export': () => json({ error: { code: 'rate_limited', message: 'You can download your data once an hour.' } }, 429),
    }));
    render(<AccountPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download my data' }));
    expect(await screen.findByText('You can download your data once an hour.')).toBeTruthy();
  });

  it('the emergency alert phone is editable here too', async () => {
    const fetchMock = stubFetch(accountRoutes({
      'PUT /api/me/alert-contact': () => json({ alert_contact: { alert_phone: '+13125550142', sms_alert_consent_at: null } }),
    }));
    render(<AccountPage />);
    fireEvent.change(await screen.findByLabelText(/your mobile number/i), { target: { value: '312 555 0142' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/alerts will come by email only/)).toBeTruthy();
    expect(bodyOf(fetchMock, 'PUT /api/me/alert-contact')).toEqual({ phone: '+13125550142', sms_consent: false });
  });
});
