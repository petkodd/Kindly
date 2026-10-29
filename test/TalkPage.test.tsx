import { StrictMode } from 'react';
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import TalkPage from '../src/app/(talk)/app/talk/page';

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

type Handler = (init?: RequestInit) => Response | Promise<Response>;
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
  vi.useRealTimers();
  tokenValue = 'tok123';
});

const AUTH_OK: Record<string, Handler> = {
  'POST /api/talk/auth': () => json({ ok: true, family_first_name: 'Sarah', link_owner: 'family' }),
};
const CONSENT_OK: Record<string, Handler> = { 'POST /api/talk/consent': () => json({ consent: {} }, 201) };
const session =
  (extra: Record<string, unknown> = {}): Handler =>
  () =>
    json({ conversation_id: 'c1', greeting: 'Hi!', ...extra }, 201);

const startButton = () => screen.findByRole('button', { name: /start talking/i });

describe('TalkPage', () => {
  it('exchanges the URL token for a cookie, strips it from the URL, then shows the intro', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const fetchMock = stubFetch({ ...AUTH_OK });
    render(<TalkPage />);

    expect(await startButton()).toBeTruthy();
    const authInit = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/auth'))?.[1] as RequestInit;
    expect(JSON.parse(String(authInit.body))).toEqual({ token: 'tok123' });
    expect(authInit.headers && (authInit.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app/talk');
  });

  it('shows the AI disclosure in large text on the intro', async () => {
    stubFetch({ ...AUTH_OK });
    render(<TalkPage />);
    await startButton();
    const disclosure = screen.getByText(/AI companion — not a real person/);
    expect(disclosure.className).toMatch(/text-lg/);
    expect(disclosure.className).not.toMatch(/text-(sm|xs)\b/);
  });

  it('a bad link tells the parent to ask the family for a new one (never "open from a fresh link")', async () => {
    stubFetch({ 'POST /api/talk/auth': () => json({ error: { code: 'unauthorized', message: 'nope' } }, 401) });
    render(<TalkPage />);
    expect(await screen.findByText(/please ask your family to send you a new link/i)).toBeTruthy();
    expect(screen.queryByText(/fresh link/i)).toBeNull();
  });

  it('with no token, proceeds to the intro (relying on an existing cookie)', async () => {
    tokenValue = null;
    stubFetch({});
    render(<TalkPage />);
    expect(await startButton()).toBeTruthy();
  });

  it('a 401 at start names the family member who set Dearly up', async () => {
    stubFetch({
      ...AUTH_OK,
      ...CONSENT_OK,
      'POST /api/talk/session': () =>
        json({ error: { code: 'unauthorized', message: 'Valid access token required.' } }, 401),
    });
    render(<TalkPage />);
    fireEvent.click(await startButton());
    expect(await screen.findByText('Please ask Sarah to send you a new link.')).toBeTruthy();
  });

  it('starts a conversation (consent + session), shows the greeting and speaks it', async () => {
    const playMock = vi.fn().mockResolvedValue(undefined);
    const audio = { play: playMock, src: '' };
    vi.stubGlobal('Audio', vi.fn().mockImplementation(() => audio));
    stubFetch({
      ...AUTH_OK,
      ...CONSENT_OK,
      'POST /api/talk/session': session({ greeting: 'Hello Robert!', greeting_audio_url: 'data:audio/mp3;base64,aGk=' }),
    });
    render(<TalkPage />);
    fireEvent.click(await startButton());
    expect(await screen.findByText('Hello Robert!')).toBeTruthy();
    await vi.waitFor(() => expect(audio.src).toBe('data:audio/mp3;base64,aGk='));
    // 1 unlock on the Start tap + 1 greeting playback.
    expect(playMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces a start error (403) in plain words, without crashing', async () => {
    stubFetch({
      ...AUTH_OK,
      ...CONSENT_OK,
      'POST /api/talk/session': () => json({ error: { code: 'forbidden', message: 'Consent required.' } }, 403),
    });
    render(<TalkPage />);
    fireEvent.click(await startButton());
    expect(await screen.findByText(/I can’t chat just now\. Please ask Sarah to check the account\./)).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  describe('typing (browser without a microphone recorder)', () => {
    it('sends a message and renders Dearly’s reply', async () => {
      stubFetch({
        ...AUTH_OK,
        ...CONSENT_OK,
        'POST /api/talk/session': session(),
        'POST /api/talk/message': () => json({ reply: 'Tell me more about that.' }),
      });
      render(<TalkPage />);
      fireEvent.click(await startButton());
      await screen.findByText('Hi!');
      expect(await screen.findByText(/voice isn’t available on this device/i)).toBeTruthy();

      fireEvent.change(screen.getByLabelText(/your message/i), { target: { value: 'I feel good today' } });
      fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

      expect(await screen.findByText('I feel good today')).toBeTruthy();
      expect(await screen.findByText('Tell me more about that.')).toBeTruthy();
    });

    it('rolls back the optimistic bubble, restores the draft and offers Try again on a failed send', async () => {
      stubFetch({
        ...AUTH_OK,
        ...CONSENT_OK,
        'POST /api/talk/session': session(),
        'POST /api/talk/message': () => json({ error: { code: 'server', message: 'Internal' } }, 502),
      });
      render(<TalkPage />);
      fireEvent.click(await startButton());
      await screen.findByText('Hi!');

      const input = (await screen.findByLabelText(/your message/i)) as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: 'I feel sad' } });
      fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

      expect(await screen.findByText(/something went wrong on my side/i)).toBeTruthy();
      expect(screen.queryByText('Internal')).toBeNull();
      expect(screen.queryByText('I feel sad', { selector: 'span' })).toBeNull();
      expect(input.value).toBe('I feel sad');
      expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    });
  });

  it('ends the conversation, then a big "Talk again" starts a fresh one', async () => {
    let sessions = 0;
    stubFetch({
      ...AUTH_OK,
      ...CONSENT_OK,
      'POST /api/talk/session': () => {
        sessions += 1;
        return json({ conversation_id: `c${sessions}`, greeting: `Hi again ${sessions}!` }, 201);
      },
      'POST /api/talk/session/end': () => json({ conversation_id: 'c1', ended_at: 'now', summarized: true }),
    });
    render(<TalkPage />);
    fireEvent.click(await startButton());
    await screen.findByText('Hi again 1!');

    const done = screen.getByRole('button', { name: /done for now/i });
    expect(done.className).toMatch(/btn-secondary/);
    fireEvent.click(done);
    expect(await screen.findByText(/take care/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /talk again/i }));
    expect(await screen.findByText('Hi again 2!')).toBeTruthy();
    expect(screen.queryByText('Hi again 1!')).toBeNull();
    expect(sessions).toBe(2);
  });

  it('large_text=false uses the smaller (still text-xl) reply size; the default is larger', async () => {
    stubFetch({
      ...AUTH_OK,
      ...CONSENT_OK,
      'POST /api/talk/session': session({
        settings: { large_text: false, voice_first: true, speech_rate: 'normal', language: 'en-US' },
      }),
    });
    render(<TalkPage />);
    fireEvent.click(await startButton());
    expect((await screen.findByText('Hi!')).className).toMatch(/text-xl/);
    cleanup();

    stubFetch({ ...AUTH_OK, ...CONSENT_OK, 'POST /api/talk/session': session() });
    render(<TalkPage />);
    fireEvent.click(await startButton());
    expect((await screen.findByText('Hi!')).className).toMatch(/text-2xl/);
  });

  describe('voice', () => {
    class FakeMediaRecorder {
      static instances: FakeMediaRecorder[] = [];
      static supported = ['audio/webm;codecs=opus', 'audio/webm'];
      static isTypeSupported = (t: string) => FakeMediaRecorder.supported.includes(t);
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state: 'inactive' | 'recording' = 'inactive';
      mimeType: string;
      options?: { mimeType?: string };
      constructor(_stream: unknown, options?: { mimeType?: string }) {
        this.options = options;
        this.mimeType = options?.mimeType ?? 'audio/webm';
        FakeMediaRecorder.instances.push(this);
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['audio-bytes']) });
        this.onstop?.();
      }
    }

    let stopTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      FakeMediaRecorder.instances = [];
      FakeMediaRecorder.supported = ['audio/webm;codecs=opus', 'audio/webm'];
      vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
      vi.stubGlobal(
        'Audio',
        vi.fn().mockImplementation(() => ({ play: vi.fn().mockResolvedValue(undefined), src: '' })),
      );
      stopTrack = vi.fn();
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
        configurable: true,
      });
    });

    async function startConversation(
      extraRoutes: Record<string, Handler> = {},
      sessionExtra: Record<string, unknown> = {},
    ) {
      const fetchMock = stubFetch({
        ...AUTH_OK,
        ...CONSENT_OK,
        'POST /api/talk/session': session(sessionExtra),
        ...extraRoutes,
      });
      const view = render(<TalkPage />);
      fireEvent.click(await startButton());
      await screen.findByText('Hi!');
      return { fetchMock, view };
    }

    const talkButton = () => screen.findByRole('button', { name: 'Talk to Dearly' });
    const recordAndSend = async () => {
      fireEvent.click(await talkButton());
      await vi.waitFor(() => expect(FakeMediaRecorder.instances.at(-1)?.state).toBe('recording'));
      fireEvent.click(await talkButton());
    };
    const VOICE_OK: Record<string, Handler> = {
      'POST /api/talk/voice': () =>
        json({
          conversation_id: 'c1',
          transcript: 'I feel good today',
          reply: 'That’s wonderful to hear.',
          tts_url: 'data:audio/mp3;base64,xyz',
        }),
    };
    const voiceUpload = (fetchMock: ReturnType<typeof stubFetch>) =>
      (fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/voice'))?.[1]?.body as FormData).get('audio') as File;

    it('one button: tap to talk, tap to send — same accessible name, state only in aria-pressed', async () => {
      const { fetchMock } = await startConversation(VOICE_OK);

      const button = await talkButton();
      expect(button.getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(button);
      await vi.waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
      expect(screen.getByRole('button', { name: 'Talk to Dearly' })).toBe(button);
      expect(screen.getByText(/I’m listening/)).toBeTruthy();

      fireEvent.click(button);
      expect(await screen.findByText('I feel good today')).toBeTruthy();
      expect(await screen.findByText('That’s wonderful to hear.')).toBeTruthy();

      const body = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/voice'))?.[1]?.body as FormData;
      expect(body.get('conversation_id')).toBe('c1');
      const audio = voiceUpload(fetchMock);
      expect(audio.name).toBe('voice.webm');
      expect(audio.type).toBe('audio/webm');
    });

    it('still sends recordings under React StrictMode (dev double-mount must not leave the discard flag set)', async () => {
      const fetchMock = stubFetch({ ...AUTH_OK, ...CONSENT_OK, 'POST /api/talk/session': session(), ...VOICE_OK });
      render(
        <StrictMode>
          <TalkPage />
        </StrictMode>,
      );
      fireEvent.click(await startButton());
      await screen.findByText('Hi!');
      await recordAndSend();
      expect(await screen.findByText('That’s wonderful to hear.')).toBeTruthy();
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/voice'))).toBe(true);
    });

    it('records MP4 on Safari-like browsers and uploads it as voice.m4a / audio/mp4', async () => {
      FakeMediaRecorder.supported = ['audio/mp4'];
      const { fetchMock } = await startConversation(VOICE_OK);
      await recordAndSend();
      await screen.findByText('I feel good today');

      expect(FakeMediaRecorder.instances[0].options).toEqual({ mimeType: 'audio/mp4' });
      const audio = voiceUpload(fetchMock);
      expect(audio.name).toBe('voice.m4a');
      expect(audio.type).toBe('audio/mp4');
    });

    it('shows "Dearly is thinking…" while a reply is on its way (not "listening")', async () => {
      let release: (r: Response) => void = () => {};
      await startConversation({ 'POST /api/talk/voice': () => new Promise<Response>((r) => (release = r)) });
      await recordAndSend();
      expect(await screen.findByText('Dearly is thinking…')).toBeTruthy();
      expect(screen.queryByText(/is listening/)).toBeNull();
      await act(async () => release(json({ conversation_id: 'c1', transcript: 't', reply: 'r', tts_url: 'data:,' })));
    });

    it('reuses one Audio element for every sound — a fresh Audio this far from the tap is autoplay-blocked on real devices', async () => {
      const playMock = vi.fn().mockResolvedValue(undefined);
      const audioCtor = vi.fn().mockImplementation(() => ({ play: playMock, src: '' }));
      vi.stubGlobal('Audio', audioCtor);

      await startConversation({
        'POST /api/talk/voice': () =>
          json({ conversation_id: 'c1', transcript: 'turn one', reply: 'reply one', tts_url: 'https://example.com/one.mp3' }),
      });
      // The Start tap already created and unlocked the element.
      expect(audioCtor).toHaveBeenCalledTimes(1);
      const unlocked = audioCtor.mock.results[0].value;

      await recordAndSend();
      expect(await screen.findByText('reply one')).toBeTruthy();

      expect(audioCtor).toHaveBeenCalledTimes(1);
      expect(unlocked.src).toBe('https://example.com/one.mp3');
      // Unlock plays on the Start, talk and send taps, plus 1 for the reply.
      await vi.waitFor(() => expect(playMock).toHaveBeenCalledTimes(4));
    });

    it('a failed transcription is a plain sentence with "Try again" and a big "Type instead"', async () => {
      await startConversation({
        'POST /api/talk/voice': () =>
          json({ error: { code: 'no_transcript', message: 'Could not transcribe audio.' } }, 422),
      });
      await recordAndSend();

      expect(await screen.findByText('Sorry, I didn’t catch that — please try again.')).toBeTruthy();
      expect(screen.queryByText('Could not transcribe audio.')).toBeNull();
      expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: /type instead/i }));
      expect(screen.getByLabelText(/your message/i)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Talk to Dearly' })).toBeNull();
      // …and the way back to voice is one tap away.
      fireEvent.click(screen.getByRole('button', { name: /use my voice instead/i }));
      expect(await talkButton()).toBeTruthy();
    });

    it('a server error keeps the clip, and "Try again" re-sends it without re-recording', async () => {
      let calls = 0;
      await startConversation({
        'POST /api/talk/voice': () => {
          calls += 1;
          return calls === 1
            ? json({ error: { code: 'server_error', message: 'boom' } }, 500)
            : json({ conversation_id: 'c1', transcript: 'second go', reply: 'got it', tts_url: 'data:,' });
        },
      });
      await recordAndSend();
      expect(await screen.findByText(/something went wrong on my side/i)).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      expect(await screen.findByText('got it')).toBeTruthy();
      expect(calls).toBe(2);
      expect(FakeMediaRecorder.instances).toHaveLength(1);
    });

    it('a network failure also offers "Type instead"', async () => {
      await startConversation({
        'POST /api/talk/voice': () => {
          throw new TypeError('Failed to fetch');
        },
      });
      await recordAndSend();
      expect(await screen.findByText(/trouble connecting/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /type instead/i })).toBeTruthy();
    });

    it('auto-stops and sends after 60 seconds, releasing the microphone', async () => {
      const { fetchMock } = await startConversation(VOICE_OK);
      vi.useFakeTimers({ shouldAdvanceTime: true });
      fireEvent.click(await talkButton());
      await vi.waitFor(() => expect(FakeMediaRecorder.instances.at(-1)?.state).toBe('recording'));
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      vi.useRealTimers();
      expect(await screen.findByText('I feel good today')).toBeTruthy();
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/voice'))).toBe(true);
      expect(stopTrack).toHaveBeenCalled();
    });

    it('leaving the page mid-recording releases the microphone and uploads nothing', async () => {
      const { fetchMock, view } = await startConversation(VOICE_OK);
      fireEvent.click(await talkButton());
      await vi.waitFor(() => expect(FakeMediaRecorder.instances.at(-1)?.state).toBe('recording'));
      view.unmount();
      expect(stopTrack).toHaveBeenCalled();
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/voice'))).toBe(false);
    });

    it('does not render the talk button when the browser lacks MediaRecorder, and falls back to typing', async () => {
      vi.stubGlobal('MediaRecorder', undefined);
      await startConversation();
      expect(screen.queryByRole('button', { name: 'Talk to Dearly' })).toBeNull();
      expect(await screen.findByLabelText(/your message/i)).toBeTruthy();
    });

    it('hides the typing box by default when voice works — talking is the way in', async () => {
      await startConversation();
      expect(await talkButton()).toBeTruthy();
      expect(screen.queryByLabelText(/your message/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /^send$/i })).toBeNull();
    });

    it('voice_first=false opens in text mode, with voice one tap away', async () => {
      await startConversation(
        {},
        { settings: { large_text: true, voice_first: false, speech_rate: 'normal', language: 'en-US' } },
      );
      expect(await screen.findByLabelText(/your message/i)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Talk to Dearly' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /use my voice instead/i }));
      expect(await talkButton()).toBeTruthy();
    });

    it('mic permission denied: says why in plain words and offers typing', async () => {
      await startConversation();
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('denied'));
      expect(screen.queryByLabelText(/your message/i)).toBeNull();

      fireEvent.click(await talkButton());
      expect(await screen.findByText(/microphone is turned off/i)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /type instead/i }));
      expect(screen.getByLabelText(/your message/i)).toBeTruthy();
    });
  });
});
