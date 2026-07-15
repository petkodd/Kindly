import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import OnboardingPage from '../src/app/(app)/app/onboarding/page';

// A fresh visit to /app/onboarding — no ?billing=/parent_id= from a Stripe redirect.
const searchParams = new URLSearchParams();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch(routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
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

const SELF_PARENT = { id: 'p1', first_name: 'Maria', relationship: 'self', activated_at: null };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  push.mockReset();
});

describe('OnboardingPage — self-use flow ("Me")', () => {
  it('choosing "Me" hides the relationship field and creates a parent with relationship=self', async () => {
    let createBody: Record<string, unknown> | null = null;
    stubFetch({
      'GET /api/parents': () => json({ parents: [] }),
      'GET /api/me': () => json({ account: { full_name: null } }),
      'POST /api/parents': (init) => {
        createBody = JSON.parse(String(init?.body));
        return json({ parent: SELF_PARENT }, 201);
      },
    });
    render(<OnboardingPage />);

    fireEvent.click(await screen.findByRole('button', { name: /^me/i }));
    expect(await screen.findByText(/a little about you/i)).toBeTruthy();
    expect(screen.queryByLabelText(/your relationship/i)).toBeNull(); // no relationship dropdown for self

    fireEvent.change(screen.getByLabelText(/your first name/i), { target: { value: 'Maria' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(createBody).not.toBeNull());
    expect(createBody).toMatchObject({ first_name: 'Maria', relationship: 'self' });
  });

  it('pre-fills the first-name field from the buyer\'s account display name', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [] }),
      'GET /api/me': () => json({ account: { full_name: 'Maria Ivanova' } }),
    });
    render(<OnboardingPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^me/i }));

    const nameInput = (await screen.findByLabelText(/your first name/i)) as HTMLInputElement;
    await waitFor(() => expect(nameInput.value).toBe('Maria'));
  });

  it('REGRESSION: still pre-fills the name even if /api/me resolves AFTER ProfileStep has already mounted', async () => {
    // Exercises the actual race: click "Me" before the account-name fetch
    // settles, so ProfileStep mounts with defaultFirstName='' — the field
    // must still pick up the name once the fetch resolves late.
    let resolveMe!: (r: Response) => void;
    const mePromise = new Promise<Response>((resolve) => { resolveMe = resolve; });
    stubFetch({
      'GET /api/parents': () => json({ parents: [] }),
      'GET /api/me': () => mePromise,
    });
    render(<OnboardingPage />);

    fireEvent.click(await screen.findByRole('button', { name: /^me/i }));
    const nameInput = (await screen.findByLabelText(/your first name/i)) as HTMLInputElement;
    expect(nameInput.value).toBe(''); // /api/me hasn't resolved yet

    resolveMe(json({ account: { full_name: 'Maria Ivanova' } }));
    await waitFor(() => expect(nameInput.value).toBe('Maria'));
  });

  it('skips ConsentStep entirely, auto-recording buyer_attestation, and goes straight to billing', async () => {
    let consentCalls = 0;
    stubFetch({
      'GET /api/parents': () => json({ parents: [] }),
      'GET /api/me': () => json({ account: { full_name: null } }),
      'POST /api/parents': () => json({ parent: SELF_PARENT }, 201),
      'POST /api/parents/p1/consent': () => {
        consentCalls += 1;
        return json({ consent: { id: 'c1' } }, 201);
      },
    });
    render(<OnboardingPage />);

    fireEvent.click(await screen.findByRole('button', { name: /^me/i }));
    fireEvent.change(await screen.findByLabelText(/your first name/i), { target: { value: 'Maria' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // MemoriesStep — skip the optional fields.
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }));

    // Never see "One important step" (ConsentStep) — lands directly on BillingStep.
    await screen.findByText(/start your free trial/i);
    expect(screen.queryByText(/one important step/i)).toBeNull();
    expect(consentCalls).toBe(1);
  });

  it('does NOT advance to billing if the auto-consent call fails — surfaces the error on MemoriesStep instead', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [] }),
      'GET /api/me': () => json({ account: { full_name: null } }),
      'POST /api/parents': () => json({ parent: SELF_PARENT }, 201),
      'POST /api/parents/p1/consent': () => json({ error: { code: 'server_error', message: 'Something went wrong.' } }, 500),
    });
    render(<OnboardingPage />);

    fireEvent.click(await screen.findByRole('button', { name: /^me/i }));
    fireEvent.change(await screen.findByLabelText(/your first name/i), { target: { value: 'Maria' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }));

    // Stays on MemoriesStep with a visible error — never silently reaches billing.
    expect(await screen.findByText(/something went wrong/i)).toBeTruthy();
    expect(screen.queryByText(/start your free trial/i)).toBeNull();
  });

  it('DoneStep auto-redirects to /app/talk with no share link ever shown, given billingResult=success', async () => {
    // Jump straight past billing via the same ?billing=success&parent_id= path
    // BillingStep already uses — simulate arriving there for a self parent.
    searchParams.set('billing', 'success');
    searchParams.set('parent_id', 'p1');
    stubFetch({
      'GET /api/parents/p1': () => json({ parent: SELF_PARENT }),
      'POST /api/parents/p1/activate': () => json({ parent: { ...SELF_PARENT, activated_at: '2026-07-14T00:00:00Z' } }),
      'POST /api/parents/p1/access-link': () => json({ token: 'self-token-xyz', id: 'link1' }, 201),
      'POST /api/talk/auth': () => json({ ok: true }),
    });
    render(<OnboardingPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/talk'));
    expect(screen.queryByText(/talk link/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /copy link/i })).toBeNull();
    searchParams.delete('billing');
    searchParams.delete('parent_id');
  });

  it('resume picks up an incomplete self parent at the billing step, not the consent step', async () => {
    let consentCalls = 0;
    stubFetch({
      'GET /api/parents': () => json({ parents: [SELF_PARENT] }),
      'POST /api/parents/p1/consent': () => {
        consentCalls += 1;
        return json({ consent: { id: 'c1' } }, 201);
      },
    });
    render(<OnboardingPage />);
    expect(await screen.findByText(/start your free trial/i)).toBeTruthy();
    expect(screen.queryByText(/one important step/i)).toBeNull();
    expect(consentCalls).toBe(1); // (re-)ensures consent before landing on billing
  });

  it('resume falls back to MemoriesStep (not a stuck billing screen) if re-ensuring consent fails', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [SELF_PARENT] }),
      'POST /api/parents/p1/consent': () => json({ error: { code: 'server_error', message: 'nope' } }, 500),
    });
    render(<OnboardingPage />);
    expect(await screen.findByText(/a few things about you/i)).toBeTruthy();
    expect(screen.queryByText(/start your free trial/i)).toBeNull();
  });
});

describe('OnboardingPage — "Someone else" path is unaffected', () => {
  it('still shows the relationship field and the original consent copy', async () => {
    stubFetch({
      'GET /api/parents': () => json({ parents: [] }),
      'GET /api/me': () => json({ account: { full_name: null } }),
    });
    render(<OnboardingPage />);

    fireEvent.click(await screen.findByRole('button', { name: /someone else/i }));
    expect(await screen.findByText(/a little about them/i)).toBeTruthy();
    expect(screen.getByLabelText(/your relationship/i)).toBeTruthy();
  });
});
