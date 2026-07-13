import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import OnboardingPage from '../src/app/(app)/app/onboarding/page';

// Jump straight to the billing-return path (?billing=success&parent_id=p1),
// which auto-activates and lands on DoneStep — the step under test — without
// having to drive the whole wizard through steps 1-4.
const searchParams = new URLSearchParams({ billing: 'success', parent_id: 'p1' });
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Handler = () => Response;

function stubFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected fetch: ${key}`);
    return handler();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const PARENT = { id: 'p1', first_name: 'Robert' };

/** Replaces `navigator` wholesale so tests control clipboard/share support explicitly. */
function mockNavigator(overrides: { share?: (...args: unknown[]) => Promise<void> }) {
  vi.stubGlobal('navigator', {
    ...window.navigator,
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    share: overrides.share,
  });
}

beforeEach(() => {
  mockNavigator({});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderAtDoneStep(routes: Record<string, Handler> = {}) {
  stubFetch({
    'GET /api/parents/p1': () => json({ parent: PARENT }),
    'POST /api/parents/p1/activate': () => json({ parent: { ...PARENT, activated_at: '2026-07-13T00:00:00Z' } }),
    ...routes,
  });
  render(<OnboardingPage />);
  expect(await screen.findByText(/all set/i)).toBeTruthy();
}

describe('OnboardingPage DoneStep — talk link handoff', () => {
  it('creates a full shareable URL, not a bare token', async () => {
    await renderAtDoneStep({
      'POST /api/parents/p1/access-link': () => json({ token: 'abc123token', id: 'link1' }, 201),
    });
    fireEvent.click(await screen.findByRole('button', { name: /create talk link/i }));

    const link = await screen.findByText(/\/app\/talk\?token=abc123token/);
    expect(link.textContent).toMatch(/^https?:\/\//);
    expect(link.textContent).not.toBe('abc123token'); // must not be the bare token
  });

  it('copies the full link to the clipboard', async () => {
    await renderAtDoneStep({
      'POST /api/parents/p1/access-link': () => json({ token: 'abc123token', id: 'link1' }, 201),
    });
    fireEvent.click(await screen.findByRole('button', { name: /create talk link/i }));
    await screen.findByText(/\/app\/talk\?token=abc123token/);

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeTruthy());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('/app/talk?token=abc123token'),
    );
  });

  it('shows a native Share button when the Web Share API is available', async () => {
    mockNavigator({ share: vi.fn().mockResolvedValue(undefined) });
    await renderAtDoneStep({
      'POST /api/parents/p1/access-link': () => json({ token: 'abc123token', id: 'link1' }, 201),
    });
    fireEvent.click(await screen.findByRole('button', { name: /create talk link/i }));
    await screen.findByText(/\/app\/talk\?token=abc123token/);

    const shareButton = await screen.findByRole('button', { name: /^share$/i });
    fireEvent.click(shareButton);
    await waitFor(() =>
      expect(navigator.share).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining('/app/talk?token=abc123token') }),
      ),
    );
  });

  it('hides the Share button when the Web Share API is unavailable', async () => {
    await renderAtDoneStep({
      'POST /api/parents/p1/access-link': () => json({ token: 'abc123token', id: 'link1' }, 201),
    });
    fireEvent.click(await screen.findByRole('button', { name: /create talk link/i }));
    await screen.findByText(/\/app\/talk\?token=abc123token/);
    expect(screen.queryByRole('button', { name: /^share$/i })).toBeNull();
  });
});
