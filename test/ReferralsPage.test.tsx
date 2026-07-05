import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ReferralsPage from '../src/app/(app)/app/referrals/page';

const replace = vi.fn();
// Stable router object — the mount effect depends on `router`; a fresh object
// per render would re-fire the effect every render (see FamilySummaryPage test).
const router = { replace };
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
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch: ${key}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const PARENT = { id: 'p1', first_name: 'Robert' };

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockReset();
});

describe('ReferralsPage', () => {
  it('prompts onboarding when there are no parents, but still shows the referral code', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [] }),
      'GET /api/referrals': () => json({ code: 'ABCD2345' }),
    });
    render(<ReferralsPage />);
    expect(await screen.findByText(/haven’t set up a parent/i)).toBeTruthy();
    expect(await screen.findByText('ABCD2345')).toBeTruthy();
  });

  it('lists recipients and sends an invitation, refreshing the list', async () => {
    let invited = false;
    stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/referrals': () => json({ code: null }),
      'GET /api/parents/p1/recipients': () =>
        json({
          recipients: invited
            ? [{ id: 'c1', email: 'mike@example.com', status: 'pending' }]
            : [],
        }),
      'POST /api/parents/p1/invite-sibling': () => {
        invited = true;
        return json({ consent_id: 'c1', status: 'pending' }, 201);
      },
    });
    render(<ReferralsPage />);

    expect(await screen.findByText(/no recipients yet/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/invite a family member/i), {
      target: { value: 'mike@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    expect(await screen.findByText('mike@example.com')).toBeTruthy();
    expect(screen.getByText('pending')).toBeTruthy();
  });

  it('validates the email client-side before hitting the API', async () => {
    const fetchMock = stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/referrals': () => json({ code: null }),
      'GET /api/parents/p1/recipients': () => json({ recipients: [] }),
    });
    render(<ReferralsPage />);
    await screen.findByText(/no recipients yet/i);
    fireEvent.change(screen.getByLabelText(/invite a family member/i), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));
    expect(await screen.findByText(/valid email/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/parents/p1/invite-sibling',
      expect.anything(),
    );
  });

  it('revokes a recipient after confirmation', async () => {
    let revoked = false;
    stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/referrals': () => json({ code: null }),
      'GET /api/parents/p1/recipients': () =>
        json({
          recipients: revoked
            ? []
            : [{ id: 'c1', email: 'mike@example.com', status: 'accepted' }],
        }),
      'POST /api/consent/c1/revoke': () => {
        revoked = true;
        return json({ ok: true });
      },
    });
    render(<ReferralsPage />);
    expect(await screen.findByText('mike@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(screen.queryByText('mike@example.com')).toBeNull());
  });

  it('generates a referral code when the buyer has none', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [] }),
      'GET /api/referrals': () => json({ code: null }),
      'POST /api/referrals': () => json({ code: 'WXYZ6789' }, 201),
    });
    render(<ReferralsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /generate a code/i }));
    expect(await screen.findByText('WXYZ6789')).toBeTruthy();
  });

  it('redirects to login on a 401 from the parents load', async () => {
    stubFetch({
      'GET /api/parents': () =>
        json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, 401),
      'GET /api/referrals': () => json({ code: null }),
    });
    render(<ReferralsPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });
});
