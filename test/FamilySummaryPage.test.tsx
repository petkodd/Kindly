import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import FamilySummaryPage from '../src/app/(app)/app/family-summary/page';

const replace = vi.fn();
// Return a STABLE router object — real Next useRouter() is referentially stable,
// and the page's mount effect depends on `router`. A fresh object per render
// would re-fire the effect every render (infinite fetch loop).
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

/** Route a stubbed fetch by method + path so each test declares only what it needs. */
function stubFetch(routes: Record<string, (init?: RequestInit) => Response>) {
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
const PREVIEW = {
  id: 's1',
  period_start: '2026-06-29',
  period_end: '2026-07-05',
  status: 'preview' as const,
  body_long: 'Robert had 2 conversations with Kindly this week.',
  body_short: 'Robert had 2 conversations with Kindly this week.',
  has_concern: false,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockReset();
});

describe('FamilySummaryPage', () => {
  it('shows an onboarding prompt when the buyer has no parents', async () => {
    stubFetch({ 'GET /api/parents': () => json({ parents: [] }) });
    render(<FamilySummaryPage />);
    expect(await screen.findByText(/haven’t set up a parent/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /set up the gift/i })).toBeTruthy();
  });

  it('renders the current-week preview and sends it to consented recipients', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/summary/preview': () => json({ summary: PREVIEW }),
      'GET /api/parents/p1/summaries': () => json({ summaries: [PREVIEW] }),
      'POST /api/parents/p1/summary/send': () =>
        json({
          summary: { ...PREVIEW, status: 'sent' },
          deliveries: [{ id: 'd1', status: 'sent' }],
        }),
    });
    render(<FamilySummaryPage />);

    expect(await screen.findByText(/2 conversations with Kindly/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /send this week’s summary/i }));
    expect(await screen.findByText(/sent to 1 recipient\./i)).toBeTruthy();
  });

  it('guides the buyer to invite a recipient when send is gated on consent (409)', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/summary/preview': () => json({ summary: PREVIEW }),
      'GET /api/parents/p1/summaries': () => json({ summaries: [PREVIEW] }),
      'POST /api/parents/p1/summary/send': () =>
        json({ error: { code: 'precondition_failed', message: 'No consented recipient.' } }, 409),
    });
    render(<FamilySummaryPage />);

    fireEvent.click(await screen.findByRole('button', { name: /send this week’s summary/i }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /invite a family member/i })).toBeTruthy(),
    );
  });

  it('redirects to login on a 401', async () => {
    stubFetch({
      'GET /api/parents': () =>
        json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, 401),
    });
    render(<FamilySummaryPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });
});
