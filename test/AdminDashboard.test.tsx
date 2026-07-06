import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AdminDashboard } from '../src/app/admin/AdminDashboard';

const replace = vi.fn();
const router = { replace };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

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

const OVERVIEW = {
  buyers: 12,
  parents_total: 9,
  parents_activated: 7,
  conversations_total: 40,
  conversations_7d: 6,
  open_flags: 1,
  summaries_sent: 15,
  waitlist: 88,
};

const FLAG = {
  id: 'f1',
  parent_id: 'abcdef12-0000-0000-0000-000000000000',
  conversation_id: null,
  severity: 'p0_crisis',
  status: 'open',
  detail: 'Mentioned self-harm',
  created_at: '2026-07-05T10:00:00Z',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockReset();
});

describe('AdminDashboard', () => {
  it('renders overview metrics and the flag queue', async () => {
    stubFetch({
      'GET /api/admin/overview': () => json({ overview: OVERVIEW }),
      'GET /api/admin/flags': () => json({ flags: [FLAG] }),
    });
    render(<AdminDashboard />);

    expect(await screen.findByText('12')).toBeTruthy(); // buyers
    expect(screen.getByText('7 / 9')).toBeTruthy(); // parents active/total
    expect(screen.getByText('Crisis')).toBeTruthy();
    expect(screen.getByText('Mentioned self-harm')).toBeTruthy();
  });

  it('resolves a flag and refetches the queue', async () => {
    let resolved = false;
    stubFetch({
      'GET /api/admin/overview': () => json({ overview: OVERVIEW }),
      'GET /api/admin/flags': () => json({ flags: resolved ? [] : [FLAG] }),
      'PATCH /api/admin/flags/f1': () => {
        resolved = true;
        return json({ flag: { ...FLAG, status: 'resolved' } });
      },
    });
    render(<AdminDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /resolve/i }));
    await waitFor(() => expect(screen.getByText(/nothing in the queue/i)).toBeTruthy());
  });

  it('keeps actions enabled after Start review (flag stays in the queue)', async () => {
    let status = 'open';
    stubFetch({
      'GET /api/admin/overview': () => json({ overview: OVERVIEW }),
      'GET /api/admin/flags': () => json({ flags: [{ ...FLAG, status }] }),
      'PATCH /api/admin/flags/f1': (init) => {
        status = JSON.parse(String(init?.body)).status;
        return json({ flag: { ...FLAG, status } });
      },
    });
    render(<AdminDashboard />);
    fireEvent.click(await screen.findByRole('button', { name: /start review/i }));

    // The flag is now 'reviewing' — still in the queue, same row. Resolve must
    // not be left permanently disabled (regression: busy stuck true on success).
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /start review/i })).toBeNull(),
    );
    expect((screen.getByRole('button', { name: /resolve/i }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('redirects to login on a 401', async () => {
    stubFetch({
      'GET /api/admin/overview': () =>
        json({ error: { code: 'unauthorized', message: 'Admin access required.' } }, 401),
      'GET /api/admin/flags': () =>
        json({ error: { code: 'unauthorized', message: 'Admin access required.' } }, 401),
    });
    render(<AdminDashboard />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });
});
