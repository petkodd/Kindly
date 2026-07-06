import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import TalkPage from '../src/app/(app)/app/talk/page';

let tokenValue: string | null = 'tok123';
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => tokenValue }),
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

// jsdom doesn't implement scrollIntoView.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  tokenValue = 'tok123';
});

describe('TalkPage', () => {
  it('shows an invalid-link message when there is no token', () => {
    tokenValue = null;
    render(<TalkPage />);
    expect(screen.getByText(/isn’t valid/i)).toBeTruthy();
  });

  it('starts a conversation (consent + session) and shows the greeting', async () => {
    const fetchMock = stubFetch({
      'POST /api/talk/consent': () => json({ consent: {} }, 201),
      'POST /api/talk/session': () => json({ conversation_id: 'c1', greeting: 'Hello Robert!' }, 201),
    });
    render(<TalkPage />);
    fireEvent.click(screen.getByRole('button', { name: /start talking/i }));

    expect(await screen.findByText('Hello Robert!')).toBeTruthy();
    // Consent + session both carry the Bearer token.
    const consentInit = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/consent'))?.[1] as RequestInit;
    expect((consentInit.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
  });

  it('sends a message and renders Kindly’s reply', async () => {
    stubFetch({
      'POST /api/talk/consent': () => json({ consent: {} }, 201),
      'POST /api/talk/session': () => json({ conversation_id: 'c1', greeting: 'Hi!' }, 201),
      'POST /api/talk/message': () => json({ reply: 'Tell me more about that.' }),
    });
    render(<TalkPage />);
    fireEvent.click(screen.getByRole('button', { name: /start talking/i }));
    await screen.findByText('Hi!');

    fireEvent.change(screen.getByLabelText(/your message/i), { target: { value: 'I feel good today' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(await screen.findByText('I feel good today')).toBeTruthy();
    expect(await screen.findByText('Tell me more about that.')).toBeTruthy();
  });

  it('rolls back the optimistic bubble and restores the draft when a send fails', async () => {
    stubFetch({
      'POST /api/talk/consent': () => json({ consent: {} }, 201),
      'POST /api/talk/session': () => json({ conversation_id: 'c1', greeting: 'Hi!' }, 201),
      'POST /api/talk/message': () => json({ error: { code: 'server', message: 'Try again.' } }, 502),
    });
    render(<TalkPage />);
    fireEvent.click(screen.getByRole('button', { name: /start talking/i }));
    await screen.findByText('Hi!');

    const input = screen.getByLabelText(/your message/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'I feel sad' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(await screen.findByText('Try again.')).toBeTruthy();
    // The optimistic message bubble (a <span>) is gone (no duplicate on retry),
    // and the text is back in the textarea so the parent can resend.
    expect(screen.queryByText('I feel sad', { selector: 'span' })).toBeNull();
    expect(input.value).toBe('I feel sad');
  });

  it('ends the conversation and shows a closing screen', async () => {
    stubFetch({
      'POST /api/talk/consent': () => json({ consent: {} }, 201),
      'POST /api/talk/session': () => json({ conversation_id: 'c1', greeting: 'Hi!' }, 201),
      'POST /api/talk/session/end': () => json({ conversation_id: 'c1', ended_at: 'now', summarized: true }),
    });
    render(<TalkPage />);
    fireEvent.click(screen.getByRole('button', { name: /start talking/i }));
    await screen.findByText('Hi!');

    fireEvent.click(screen.getByRole('button', { name: /done for now/i }));
    expect(await screen.findByText(/take care/i)).toBeTruthy();
  });

  it('surfaces a start error (e.g. 403 no consent path) without crashing', async () => {
    stubFetch({
      'POST /api/talk/consent': () => json({ consent: {} }, 201),
      'POST /api/talk/session': () =>
        json({ error: { code: 'forbidden', message: 'Consent required.' } }, 403),
    });
    render(<TalkPage />);
    fireEvent.click(screen.getByRole('button', { name: /start talking/i }));
    expect(await screen.findByText('Consent required.')).toBeTruthy();
  });
});
