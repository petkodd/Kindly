import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
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
  vi.unstubAllGlobals();
  tokenValue = 'tok123';
});

const AUTH_OK: Record<string, Handler> = { 'POST /api/talk/auth': () => json({ ok: true }) };

describe('TalkPage', () => {
  it('exchanges the URL token for a cookie, strips it from the URL, then shows the intro', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const fetchMock = stubFetch({ ...AUTH_OK });
    render(<TalkPage />);

    // Intro appears only after the exchange resolves.
    expect(await screen.findByRole('button', { name: /start talking/i })).toBeTruthy();
    const authInit = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/auth'))?.[1] as RequestInit;
    expect(JSON.parse(String(authInit.body))).toEqual({ token: 'tok123' });
    // No Bearer header — auth now rides on the httpOnly cookie.
    expect(authInit.headers && (authInit.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app/talk');
  });

  it('shows an invalid-link message when the token exchange fails', async () => {
    stubFetch({ 'POST /api/talk/auth': () => json({ error: { code: 'unauthorized', message: 'nope' } }, 401) });
    render(<TalkPage />);
    expect(await screen.findByText(/isn’t valid/i)).toBeTruthy();
  });

  it('with no token, proceeds to the intro (relying on an existing cookie)', async () => {
    tokenValue = null;
    stubFetch({});
    render(<TalkPage />);
    expect(await screen.findByRole('button', { name: /start talking/i })).toBeTruthy();
  });

  it('starts a conversation (consent + session) and shows the greeting', async () => {
    stubFetch({
      ...AUTH_OK,
      'POST /api/talk/consent': () => json({ consent: {} }, 201),
      'POST /api/talk/session': () => json({ conversation_id: 'c1', greeting: 'Hello Robert!' }, 201),
    });
    render(<TalkPage />);
    fireEvent.click(await screen.findByRole('button', { name: /start talking/i }));
    expect(await screen.findByText('Hello Robert!')).toBeTruthy();
  });

  it('sends a message and renders Kindly’s reply', async () => {
    stubFetch({
      ...AUTH_OK,
      'POST /api/talk/consent': () => json({ consent: {} }, 201),
      'POST /api/talk/session': () => json({ conversation_id: 'c1', greeting: 'Hi!' }, 201),
      'POST /api/talk/message': () => json({ reply: 'Tell me more about that.' }),
    });
    render(<TalkPage />);
    fireEvent.click(await screen.findByRole('button', { name: /start talking/i }));
    await screen.findByText('Hi!');

    fireEvent.change(screen.getByLabelText(/your message/i), { target: { value: 'I feel good today' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(await screen.findByText('I feel good today')).toBeTruthy();
    expect(await screen.findByText('Tell me more about that.')).toBeTruthy();
  });

  it('rolls back the optimistic bubble and restores the draft when a send fails', async () => {
    stubFetch({
      ...AUTH_OK,
      'POST /api/talk/consent': () => json({ consent: {} }, 201),
      'POST /api/talk/session': () => json({ conversation_id: 'c1', greeting: 'Hi!' }, 201),
      'POST /api/talk/message': () => json({ error: { code: 'server', message: 'Try again.' } }, 502),
    });
    render(<TalkPage />);
    fireEvent.click(await screen.findByRole('button', { name: /start talking/i }));
    await screen.findByText('Hi!');

    const input = screen.getByLabelText(/your message/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'I feel sad' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(await screen.findByText('Try again.')).toBeTruthy();
    expect(screen.queryByText('I feel sad', { selector: 'span' })).toBeNull();
    expect(input.value).toBe('I feel sad');
  });

  it('ends the conversation and shows a closing screen', async () => {
    stubFetch({
      ...AUTH_OK,
      'POST /api/talk/consent': () => json({ consent: {} }, 201),
      'POST /api/talk/session': () => json({ conversation_id: 'c1', greeting: 'Hi!' }, 201),
      'POST /api/talk/session/end': () => json({ conversation_id: 'c1', ended_at: 'now', summarized: true }),
    });
    render(<TalkPage />);
    fireEvent.click(await screen.findByRole('button', { name: /start talking/i }));
    await screen.findByText('Hi!');

    fireEvent.click(screen.getByRole('button', { name: /done for now/i }));
    expect(await screen.findByText(/take care/i)).toBeTruthy();
  });

  it('surfaces a start error (e.g. 403 no consent path) without crashing', async () => {
    stubFetch({
      ...AUTH_OK,
      'POST /api/talk/consent': () => json({ consent: {} }, 201),
      'POST /api/talk/session': () =>
        json({ error: { code: 'forbidden', message: 'Consent required.' } }, 403),
    });
    render(<TalkPage />);
    fireEvent.click(await screen.findByRole('button', { name: /start talking/i }));
    expect(await screen.findByText('Consent required.')).toBeTruthy();
  });

  describe('voice', () => {
    class FakeMediaRecorder {
      static instances: FakeMediaRecorder[] = [];
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      mimeType = 'audio/webm';
      constructor() {
        FakeMediaRecorder.instances.push(this);
      }
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob(['audio-bytes']) });
        this.onstop?.();
      }
    }

    beforeEach(() => {
      FakeMediaRecorder.instances = [];
      vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
      vi.stubGlobal('Audio', vi.fn().mockImplementation(() => ({ play: vi.fn().mockResolvedValue(undefined) })));
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
        configurable: true,
      });
    });

    async function startConversation(extraRoutes: Record<string, Handler> = {}) {
      const fetchMock = stubFetch({
        ...AUTH_OK,
        'POST /api/talk/consent': () => json({ consent: {} }, 201),
        'POST /api/talk/session': () => json({ conversation_id: 'c1', greeting: 'Hi!' }, 201),
        ...extraRoutes,
      });
      render(<TalkPage />);
      fireEvent.click(await screen.findByRole('button', { name: /start talking/i }));
      await screen.findByText('Hi!');
      return fetchMock;
    }

    it('records, uploads, and shows the transcript and reply', async () => {
      const fetchMock = await startConversation({
        'POST /api/talk/voice': () =>
          json({
            conversation_id: 'c1',
            transcript: 'I feel good today',
            reply: 'That’s wonderful to hear.',
            tts_url: 'data:audio/mp3;base64,xyz',
          }),
      });

      fireEvent.click(screen.getByRole('button', { name: /talk out loud/i }));
      expect(await screen.findByRole('button', { name: /tap to stop/i })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: /tap to stop/i }));

      expect(await screen.findByText('I feel good today')).toBeTruthy();
      expect(await screen.findByText('That’s wonderful to hear.')).toBeTruthy();

      const voiceCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/voice'));
      const body = voiceCall?.[1]?.body as FormData;
      expect(body.get('conversation_id')).toBe('c1');
      expect(body.get('audio')).toBeInstanceOf(Blob);
    });

    it('shows an error when microphone access is denied, without crashing', async () => {
      await startConversation();
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('denied'),
      );

      fireEvent.click(screen.getByRole('button', { name: /talk out loud/i }));
      expect(await screen.findByText(/allow microphone access/i)).toBeTruthy();
    });

    it('surfaces a server error from the voice endpoint', async () => {
      await startConversation({
        'POST /api/talk/voice': () =>
          json({ error: { code: 'no_transcript', message: 'Could not transcribe audio.' } }, 422),
      });

      fireEvent.click(screen.getByRole('button', { name: /talk out loud/i }));
      fireEvent.click(await screen.findByRole('button', { name: /tap to stop/i }));

      expect(await screen.findByText('Could not transcribe audio.')).toBeTruthy();
    });

    it('does not render the mic button when the browser lacks MediaRecorder support', async () => {
      vi.stubGlobal('MediaRecorder', undefined);
      await startConversation();
      expect(screen.queryByRole('button', { name: /talk out loud/i })).toBeNull();
    });
  });
});
