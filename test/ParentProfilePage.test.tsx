import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ParentProfilePage from '../src/app/(app)/app/parent-profile/page';

const replace = vi.fn();
const push = vi.fn();
// Stable router — the useParents mount effect depends on `router`; a fresh object
// per render would loop the effect (see FamilySummaryPage test).
const router = { replace, push };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Handler = (init?: RequestInit) => Response;
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

const PARENT = {
  id: 'p1',
  first_name: 'Robert',
  relationship: 'father',
  pronouns: 'he/him',
  city: 'Detroit',
  language: 'en-US',
  large_text: true,
  voice_first: true,
  speech_rate: 'slow',
  activated_at: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockReset();
  push.mockReset();
});

describe('ParentProfilePage', () => {
  it('prompts onboarding when there are no parents', async () => {
    stubFetch({ 'GET /api/parents': () => json({ parents: [] }) });
    render(<ParentProfilePage />);
    expect(await screen.findByText(/haven’t set up Kindly/i)).toBeTruthy();
  });

  it('loads the profile and saves edited accessibility settings', async () => {
    let patchBody: Record<string, unknown> | null = null;
    stubFetch({
      'GET /api/parents': () => json({ parents: [{ id: 'p1', first_name: 'Robert' }] }),
      'GET /api/parents/p1': () => json({ parent: PARENT }),
      'PATCH /api/parents/p1': (init) => {
        patchBody = JSON.parse(String(init?.body));
        return json({ parent: { ...PARENT, city: 'Chicago', speech_rate: 'normal' } });
      },
    });
    render(<ParentProfilePage />);

    // Form is populated from the loaded parent.
    const city = (await screen.findByLabelText('City')) as HTMLInputElement;
    expect(city.value).toBe('Detroit');

    fireEvent.change(city, { target: { value: 'Chicago' } });
    fireEvent.change(screen.getByLabelText('Speech pace'), { target: { value: 'normal' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(patchBody).toMatchObject({
      city: 'Chicago',
      speech_rate: 'normal',
      pronouns: 'he/him',
      language: 'en-US',
      large_text: true,
      voice_first: true,
    });
  });

  it('surfaces a save error from the API', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [{ id: 'p1', first_name: 'Robert' }] }),
      'GET /api/parents/p1': () => json({ parent: PARENT }),
      'PATCH /api/parents/p1': () =>
        json({ error: { code: 'invalid_input', message: 'City is too long.' } }, 400),
    });
    render(<ParentProfilePage />);
    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));
    expect(await screen.findByText('City is too long.')).toBeTruthy();
  });

  it('redirects to login on a 401 from the parents load', async () => {
    stubFetch({
      'GET /api/parents': () =>
        json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, 401),
    });
    render(<ParentProfilePage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  describe('billing section (activated parents only)', () => {
    const ACTIVATED_PARENT = { ...PARENT, activated_at: '2026-07-01T00:00:00Z' };

    it('does not render for a not-yet-activated parent', async () => {
      stubFetch({
        'GET /api/parents': () => json({ parents: [{ id: 'p1', first_name: 'Robert' }] }),
        'GET /api/parents/p1': () => json({ parent: PARENT }), // activated_at: null
      });
      render(<ParentProfilePage />);
      await screen.findByRole('button', { name: /save changes/i }); // wait for profile to load
      expect(screen.queryByText('Billing')).toBeNull();
    });

    it('offers a "start trial" recovery path for an activated parent with no current billing', async () => {
      stubFetch({
        'GET /api/parents': () => json({ parents: [{ id: 'p1', first_name: 'Robert' }] }),
        'GET /api/parents/p1': () => json({ parent: ACTIVATED_PARENT }),
        'GET /api/parents/p1/subscription': () => json({ subscription: null, is_current: false }),
      });
      render(<ParentProfilePage />);
      expect(await screen.findByText('Billing')).toBeTruthy();
      expect(await screen.findByRole('button', { name: /start 7-day free trial/i })).toBeTruthy();
    });

    it('shows the current status instead of a trial CTA once billing is current', async () => {
      stubFetch({
        'GET /api/parents': () => json({ parents: [{ id: 'p1', first_name: 'Robert' }] }),
        'GET /api/parents/p1': () => json({ parent: ACTIVATED_PARENT }),
        'GET /api/parents/p1/subscription': () =>
          json({ subscription: { status: 'trialing', current_period_end: '2026-07-20T00:00:00Z' }, is_current: true }),
      });
      render(<ParentProfilePage />);
      expect(await screen.findByText(/free trial/i)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /start 7-day free trial/i })).toBeNull();
    });
  });

  describe('"Talk to Kindly" section (self profiles only)', () => {
    const SELF_PARENT = { ...PARENT, relationship: 'self', activated_at: '2026-07-01T00:00:00Z' };
    const GIFT_PARENT = { ...PARENT, relationship: 'father', activated_at: '2026-07-01T00:00:00Z' };

    it('does not render for a gifted (non-self) parent', async () => {
      stubFetch({
        'GET /api/parents': () => json({ parents: [{ id: 'p1', first_name: 'Robert' }] }),
        'GET /api/parents/p1': () => json({ parent: GIFT_PARENT }),
        'GET /api/parents/p1/subscription': () => json({ subscription: null, is_current: false }),
      });
      render(<ParentProfilePage />);
      await screen.findByText('Billing');
      expect(screen.queryByText('Talk to Kindly')).toBeNull();
    });

    it('renders for a self profile and performs the access-link -> talk/auth handshake, then navigates', async () => {
      let accessLinkBody: unknown = null;
      let talkAuthBody: unknown = null;
      stubFetch({
        'GET /api/parents': () => json({ parents: [{ id: 'p1', first_name: 'Robert' }] }),
        'GET /api/parents/p1': () => json({ parent: SELF_PARENT }),
        'GET /api/parents/p1/subscription': () => json({ subscription: null, is_current: false }),
        'POST /api/parents/p1/access-link': (init) => {
          accessLinkBody = JSON.parse(String(init?.body));
          return json({ token: 'self-token-abc', id: 'link1' }, 201);
        },
        'POST /api/talk/auth': (init) => {
          talkAuthBody = JSON.parse(String(init?.body));
          return json({ ok: true });
        },
      });
      render(<ParentProfilePage />);

      const button = await screen.findByRole('button', { name: /start talking/i });
      fireEvent.click(button);

      await waitFor(() => expect(push).toHaveBeenCalledWith('/app/talk'));
      // keep_existing so re-entering from this device doesn't revoke another
      // device's already-authenticated talk session for the same self profile.
      expect(accessLinkBody).toEqual({ keep_existing: true });
      expect(talkAuthBody).toEqual({ token: 'self-token-abc' });
    });
  });

  describe('relationship display label', () => {
    it('shows "You" instead of the literal "self" for a self profile', async () => {
      stubFetch({
        'GET /api/parents': () => json({ parents: [{ id: 'p1', first_name: 'Robert' }] }),
        'GET /api/parents/p1': () => json({ parent: { ...PARENT, relationship: 'self', activated_at: '2026-07-01T00:00:00Z' } }),
        'GET /api/parents/p1/subscription': () => json({ subscription: null, is_current: false }),
      });
      render(<ParentProfilePage />);
      expect(await screen.findByText(/You · active/i)).toBeTruthy();
      expect(screen.queryByText(/^self/i)).toBeNull();
    });

    it('still shows a sensible label for a gifted parent', async () => {
      stubFetch({
        'GET /api/parents': () => json({ parents: [{ id: 'p1', first_name: 'Robert' }] }),
        'GET /api/parents/p1': () => json({ parent: PARENT }), // relationship: 'father'
      });
      render(<ParentProfilePage />);
      expect(await screen.findByText(/Father/)).toBeTruthy();
    });
  });
});
