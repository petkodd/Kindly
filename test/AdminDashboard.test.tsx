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

const METRICS = {
  retention: {
    w1: { eligible: 4, retained: 2, pct: 0.5 },
    w2: { eligible: 0, retained: 0, pct: null },
    w4: { eligible: 3, retained: 1, pct: 1 / 3 },
  },
  cost_buckets: [
    {
      bucket_start: '2026-07-18',
      active_users: 2,
      voice_minutes: 5,
      total_cost_micros: 300_000,
      cost_per_active_user_micros: 150_000,
      cost_per_voice_minute_micros: 60_000,
    },
    {
      bucket_start: '2026-07-19',
      active_users: 1,
      voice_minutes: 0,
      total_cost_micros: 0,
      cost_per_active_user_micros: 0,
      cost_per_voice_minute_micros: null,
    },
  ],
  granularity: 'day',
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
      'GET /api/admin/metrics?granularity=day': () => json(METRICS),
    });
    render(<AdminDashboard />);

    expect(await screen.findByText('12')).toBeTruthy(); // buyers
    expect(screen.getByText('7 / 9')).toBeTruthy(); // parents active/total
    expect(screen.getByText('Crisis')).toBeTruthy();
    expect(screen.getByText('Mentioned self-harm')).toBeTruthy();
  });

  it('renders cost & retention metrics, including null cells for zero-denominator buckets/windows', async () => {
    stubFetch({
      'GET /api/admin/overview': () => json({ overview: OVERVIEW }),
      'GET /api/admin/flags': () => json({ flags: [] }),
      'GET /api/admin/metrics?granularity=day': () => json(METRICS),
    });
    render(<AdminDashboard />);

    expect(await screen.findByText('50%')).toBeTruthy(); // W1 pct
    expect(screen.getByText('—', { selector: 'p.text-3xl' })).toBeTruthy(); // W2 pct is null
    expect(screen.getByText('$0.30')).toBeTruthy(); // 2026-07-18 total cost (300,000 micros)
    // 2026-07-19 bucket: zero voice minutes -> cost/voice-minute renders "—", not a crash.
    const rows = screen.getAllByRole('row');
    const day19Row = rows.find((r) => r.textContent?.includes('2026-07-19'));
    expect(day19Row?.textContent).toContain('—');
  });

  it('switches to weekly granularity on toggle click', async () => {
    const fetchMock = stubFetch({
      'GET /api/admin/overview': () => json({ overview: OVERVIEW }),
      'GET /api/admin/flags': () => json({ flags: [] }),
      'GET /api/admin/metrics?granularity=day': () => json(METRICS),
      'GET /api/admin/metrics?granularity=week': () => json({ ...METRICS, granularity: 'week' }),
    });
    render(<AdminDashboard />);
    await screen.findByText('50%');

    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/admin/metrics?granularity=week')).toBe(true),
    );
  });

  it('resolves a flag and refetches the queue', async () => {
    let resolved = false;
    stubFetch({
      'GET /api/admin/overview': () => json({ overview: OVERVIEW }),
      'GET /api/admin/flags': () => json({ flags: resolved ? [] : [FLAG] }),
      'GET /api/admin/metrics?granularity=day': () => json(METRICS),
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
      'GET /api/admin/metrics?granularity=day': () => json(METRICS),
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
      'GET /api/admin/metrics?granularity=day': () =>
        json({ error: { code: 'unauthorized', message: 'Admin access required.' } }, 401),
    });
    render(<AdminDashboard />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });
});
