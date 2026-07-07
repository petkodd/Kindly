import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ParentGate } from '../src/components/ParentGate';

const replace = vi.fn();
// Stable router — the useParents mount effect depends on it.
const router = { replace };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(res: () => Response) {
  vi.stubGlobal('fetch', vi.fn(async () => res()));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  replace.mockReset();
});

describe('ParentGate', () => {
  it('shows a loading state until the parents arrive, then renders children', async () => {
    stubFetch(() => json({ parents: [{ id: 'p1', first_name: 'Robert' }] }));
    render(
      <ParentGate>
        {({ parents, selected }) => (
          <p>
            {parents.length} parent, selected {selected}
          </p>
        )}
      </ParentGate>,
    );
    expect(screen.getByText(/loading/i)).toBeTruthy();
    expect(await screen.findByText('1 parent, selected p1')).toBeTruthy();
  });

  it('surfaces a non-auth load error instead of children', async () => {
    stubFetch(() => json({ error: { code: 'x', message: 'boom' } }, 500));
    render(<ParentGate>{() => <p>should not render</p>}</ParentGate>);
    expect(await screen.findByText(/could not load your family/i)).toBeTruthy();
    expect(screen.queryByText('should not render')).toBeNull();
  });

  it('redirects to /login on a 401', async () => {
    stubFetch(() => json({ error: { code: 'unauthorized', message: 'nope' } }, 401));
    render(<ParentGate>{() => <p>x</p>}</ParentGate>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });
});
