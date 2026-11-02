import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import ParentProfilePage from '../src/app/(app)/app/parent-profile/page';
import { AuthForm } from '../src/components/AuthForm';
import { WaitlistForm } from '../src/components/WaitlistForm';
import { useUnsavedChangesWarning, UNSAVED_CHANGES_MESSAGE } from '../src/hooks/useUnsavedChangesWarning';
import { ParentPicker } from '../src/components/ParentPicker';
import { validateProfile } from '../src/lib/profileValidation';
import { PARENT_SHORT_FIELD_MAX } from '../src/lib/types';
import NotFound from '../src/app/not-found';
import RouteError from '../src/app/error';

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
// The 404 page reuses the public header/footer; their auth status fetch isn't under test here.
vi.mock('../src/components/SiteHeader', () => ({ SiteHeader: () => <header>header</header> }));
vi.mock('../src/components/SiteFooter', () => ({ SiteFooter: () => <footer>footer</footer> }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function stubFetch(routes: Record<string, (init?: RequestInit) => Response>) {
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
});

describe('profile validation (chat 12)', () => {
  it('mirrors the server cap on pronouns and city', () => {
    expect(validateProfile({ pronouns: 'she/her', city: 'Detroit' })).toEqual({});
    const long = 'x'.repeat(PARENT_SHORT_FIELD_MAX + 1);
    expect(validateProfile({ pronouns: long, city: long })).toEqual({
      pronouns: `Pronouns must be ${PARENT_SHORT_FIELD_MAX} characters or fewer.`,
      city: `City must be ${PARENT_SHORT_FIELD_MAX} characters or fewer.`,
    });
    // trimmed, like the server
    expect(validateProfile({ pronouns: ` ${'x'.repeat(PARENT_SHORT_FIELD_MAX)} `, city: '' })).toEqual({});
  });
});

describe('parent profile form (chat 12)', () => {
  function stubProfile(extra: Record<string, (init?: RequestInit) => Response> = {}) {
    return stubFetch({
      'GET /api/parents': () => json({ parents: [PARENT] }),
      'GET /api/parents/p1': () => json({ parent: PARENT }),
      ...extra,
    });
  }

  it('caps the text fields at the server limit and shows the cap', async () => {
    stubProfile();
    render(<ParentProfilePage />);
    const city = (await screen.findByLabelText('City')) as HTMLInputElement;
    expect(city.maxLength).toBe(PARENT_SHORT_FIELD_MAX);
    expect((screen.getByLabelText('Pronouns') as HTMLInputElement).maxLength).toBe(PARENT_SHORT_FIELD_MAX);
    const help = document.getElementById(city.getAttribute('aria-describedby') ?? '');
    expect(help?.textContent).toBe(`Optional · 7/${PARENT_SHORT_FIELD_MAX} characters`);
  });

  it('marks an over-long field invalid inline and does not send it', async () => {
    const fetchMock = stubProfile();
    render(<ParentProfilePage />);
    const city = (await screen.findByLabelText('City')) as HTMLInputElement;
    // e.g. a value that predates the cap: bypass maxLength like a paste of old data would
    fireEvent.change(city, { target: { value: 'x'.repeat(PARENT_SHORT_FIELD_MAX + 5) } });
    fireEvent.blur(city);
    expect(city.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(`City must be ${PARENT_SHORT_FIELD_MAX} characters or fewer.`)).toBeTruthy();
    expect(city.getAttribute('aria-describedby')).toContain('pp-city-error');
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/fix the highlighted fields/);
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit | undefined)?.method !== 'PATCH')).toBe(true);
  });

  it('success and error look different: success is a status, error is an alert', async () => {
    let fail = false;
    stubProfile({
      'PATCH /api/parents/p1': () =>
        fail ? json({ error: { code: 'invalid_input', message: 'Something is off.' } }, 400) : json({ parent: PARENT }),
    });
    render(<ParentProfilePage />);
    fireEvent.change(await screen.findByLabelText('City'), { target: { value: 'Dayton' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved.'));
    expect(screen.queryByRole('alert')).toBeNull();
    fail = true;
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Toledo' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect((await screen.findByRole('alert')).textContent).toBe('Something is off.');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('Enter in a field submits the form', async () => {
    const fetchMock = stubProfile({ 'PATCH /api/parents/p1': () => json({ parent: PARENT }) });
    render(<ParentProfilePage />);
    const city = await screen.findByLabelText('City');
    fireEvent.change(city, { target: { value: 'Dayton' } });
    fireEvent.submit(city.closest('form') as HTMLFormElement);
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')).toBe(true));
  });

  it('warns about unsaved changes before the page unloads, and stops after saving', async () => {
    stubProfile({ 'PATCH /api/parents/p1': (init) => json({ parent: { ...PARENT, ...JSON.parse(String(init?.body)) } }) });
    render(<ParentProfilePage />);
    const city = await screen.findByLabelText('City');
    const unload = () => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(false);
    fireEvent.change(city, { target: { value: 'Dayton' } });
    expect(screen.getByText('You have unsaved changes.')).toBeTruthy();
    expect(unload()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Saved.');
    expect(unload()).toBe(false);
  });
});

const onSelect = vi.fn();
function Dirty({ dirty }: { dirty: boolean }) {
  useUnsavedChangesWarning(dirty);
  return (
    <>
      <a href="/app/memories">Memories</a>
      <a href="#section">Jump</a>
      <a href="https://example.com/">Elsewhere</a>
      <ParentPicker
        parents={[
          { id: 'p1', first_name: 'Mom' },
          { id: 'p2', first_name: 'Dad' },
        ]}
        selected="p1"
        onSelect={onSelect}
      />
    </>
  );
}

describe('useUnsavedChangesWarning (chat 12)', () => {
  function clickLink(name: string) {
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    screen.getByText(name).dispatchEvent(ev);
    return ev.defaultPrevented;
  }

  it('asks before an in-app link navigates away, and stays if the person cancels', () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    render(<Dirty dirty />);
    expect(clickLink('Memories')).toBe(true);
    expect(confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
  });

  it('lets the navigation through when the person confirms', () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<Dirty dirty />);
    expect(clickLink('Memories')).toBe(false);
  });

  it('ignores same-page hash links and external links (beforeunload covers those)', () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    render(<Dirty dirty />);
    clickLink('Jump');
    clickLink('Elsewhere');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before switching parent (which discards the form), and keeps the parent if cancelled', () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    onSelect.mockClear();
    render(<Dirty dirty />);
    fireEvent.click(screen.getByRole('button', { name: 'Dad' }));
    expect(confirm).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE);
    expect(onSelect).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Dad' }));
    expect(onSelect).toHaveBeenCalledWith('p2');
  });

  it('does not ask when re-clicking the selected parent', () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    render(<Dirty dirty />);
    fireEvent.click(screen.getByRole('button', { name: 'Mom' }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does nothing when there are no changes', () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    render(<Dirty dirty={false} />);
    clickLink('Memories');
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('auth + waitlist forms (chat 12)', () => {
  it('AuthForm submits on Enter (a real <form>) and marks the bad field invalid', async () => {
    stubFetch({});
    render(<AuthForm mode="login" />);
    const email = screen.getByLabelText('Email');
    fireEvent.change(email, { target: { value: 'not-an-email' } });
    fireEvent.submit(email.closest('form') as HTMLFormElement);
    expect((await screen.findByRole('alert')).textContent).toMatch(/valid email/);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toBe('auth-error');
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBeNull();
  });

  it('WaitlistForm submits on Enter', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<WaitlistForm />);
    const email = screen.getByLabelText('Your email');
    fireEvent.change(email, { target: { value: 'sam@example.com' } });
    fireEvent.submit(email.closest('form') as HTMLFormElement);
    expect(await screen.findByText(/on the list/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('not-found and error pages (chat 12)', () => {
  it('404 is branded, has one h1 and ways forward', () => {
    render(<NotFound />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('We couldn’t find that page');
    expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe('/');
    expect(document.querySelector('main#main')).toBeTruthy();
  });

  it('error boundary shows calm copy and Try again calls reset', () => {
    const reset = vi.fn();
    render(<RouteError error={new Error('boom')} reset={reset} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Something went wrong');
    expect(screen.queryByText(/boom/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
