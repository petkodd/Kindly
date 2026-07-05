import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import MemoriesPage from '../src/app/(app)/app/memories/page';

const replace = vi.fn();
// Stable router — the mount effect depends on `router`; a fresh object per render
// would loop the effect (see FamilySummaryPage test).
const router = { replace };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
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

const PARENT = { id: 'p1', first_name: 'Robert' };
const proposedMem = {
  id: 'm1',
  layer: 'interest',
  mem_key: 'team',
  mem_value: 'Loves the Tigers',
  status: 'proposed',
  sensitivity: 'normal',
};
const confirmedMem = {
  id: 'm2',
  layer: 'core',
  mem_key: 'hometown',
  mem_value: 'Grew up in Detroit',
  status: 'confirmed',
  sensitivity: 'normal',
};

beforeEach(() => {
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockReset();
});

describe('MemoriesPage', () => {
  it('prompts onboarding when there are no parents', async () => {
    stubFetch({ 'GET /api/parents': () => json({ parents: [] }) });
    render(<MemoriesPage />);
    expect(await screen.findByText(/haven’t set up a parent/i)).toBeTruthy();
  });

  it('shows proposed and confirmed sections', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/memories': () => json({ memories: [proposedMem, confirmedMem] }),
    });
    render(<MemoriesPage />);
    expect(await screen.findByText('Loves the Tigers')).toBeTruthy();
    expect(screen.getByText('Grew up in Detroit')).toBeTruthy();
    expect(screen.getByRole('button', { name: /confirm/i })).toBeTruthy();
  });

  it('confirms a proposed memory and refreshes', async () => {
    let confirmed = false;
    stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/memories': () =>
        json({ memories: confirmed ? [{ ...proposedMem, status: 'confirmed' }] : [proposedMem] }),
      'PATCH /api/memories/m1': () => {
        confirmed = true;
        return json({ memory: { ...proposedMem, status: 'confirmed' } });
      },
    });
    render(<MemoriesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /confirm/i }));
    // After refresh it moves out of "waiting for review".
    await waitFor(() => expect(screen.getByText(/nothing waiting for review/i)).toBeTruthy());
  });

  it('removes a confirmed memory after confirmation', async () => {
    let removed = false;
    stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1/memories': () => json({ memories: removed ? [] : [confirmedMem] }),
      'DELETE /api/memories/m2': () => {
        removed = true;
        return json(null, 204);
      },
    });
    render(<MemoriesPage />);
    expect(await screen.findByText('Grew up in Detroit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(screen.queryByText('Grew up in Detroit')).toBeNull());
  });

  it('redirects to login on a 401', async () => {
    stubFetch({
      'GET /api/parents': () =>
        json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, 401),
    });
    render(<MemoriesPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });
});
