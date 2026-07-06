import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ParentProfilePage from '../src/app/(app)/app/parent-profile/page';

const replace = vi.fn();
// Stable router — the useParents mount effect depends on `router`; a fresh object
// per render would loop the effect (see FamilySummaryPage test).
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
});

describe('ParentProfilePage', () => {
  it('prompts onboarding when there are no parents', async () => {
    stubFetch({ 'GET /api/parents': () => json({ parents: [] }) });
    render(<ParentProfilePage />);
    expect(await screen.findByText(/haven’t set up a parent/i)).toBeTruthy();
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
});
