import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MagicLinkVerify } from '../src/components/MagicLinkVerify';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams('token=abc123'),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      const key = `${method} ${url}`;
      const handler = routes[key];
      if (!handler) throw new Error(`unexpected fetch: ${key}`);
      return handler(init);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockReset();
});

describe('MagicLinkVerify', () => {
  it('redirects a buyer with an activated parent straight to family-summary', async () => {
    stubFetch({
      'POST /api/auth/magic/verify': () => json({ ok: true }),
      'GET /api/parents': () => json({ parents: [{ id: 'p1', activated_at: '2026-01-01T00:00:00Z' }] }),
    });
    render(<MagicLinkVerify />);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/family-summary'));
  });

  it('sends a buyer with no activated parent into onboarding', async () => {
    stubFetch({
      'POST /api/auth/magic/verify': () => json({ ok: true }),
      'GET /api/parents': () => json({ parents: [] }),
    });
    render(<MagicLinkVerify />);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/onboarding'));
  });
});
