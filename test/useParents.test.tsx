import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import { useParents } from '../src/hooks/useParents';

const replace = vi.fn();
// Stable router object — useParents' mount effect depends on `router`; a fresh
// object per render would re-fire the effect every render (see the page tests).
const router = { replace };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(handler: () => Response) {
  vi.stubGlobal('fetch', vi.fn(async () => handler()));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockReset();
});

describe('useParents', () => {
  it('loads the parents and selects the first one', async () => {
    stubFetch(() =>
      json({ parents: [{ id: 'p1', first_name: 'Robert' }, { id: 'p2', first_name: 'Mary' }] }),
    );
    const { result } = renderHook(() => useParents());

    expect(result.current.parents).toBeNull();
    await waitFor(() => expect(result.current.parents).toHaveLength(2));
    expect(result.current.selected).toBe('p1');
    expect(result.current.loadError).toBe('');
  });

  it('leaves nothing selected when the buyer has no parents', async () => {
    stubFetch(() => json({ parents: [] }));
    const { result } = renderHook(() => useParents());

    await waitFor(() => expect(result.current.parents).toEqual([]));
    expect(result.current.selected).toBe('');
  });

  it('redirects to /login on a 401', async () => {
    stubFetch(() => json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, 401));
    renderHook(() => useParents());

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('surfaces a load error on a non-auth failure', async () => {
    stubFetch(() => json({ error: { code: 'server_error', message: 'boom' } }, 500));
    const { result } = renderHook(() => useParents());

    await waitFor(() => expect(result.current.loadError).toBe('Could not load your family.'));
    expect(replace).not.toHaveBeenCalled();
  });
});
