'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';

type Phase = 'intro' | 'active' | 'ended';
type Role = 'parent' | 'kindly';
interface Turn {
  id: number;
  role: Role;
  content: string;
}

// Compliance-sensitive: Dearly must disclose it's an AI. Single-sourced so the
// intro and in-conversation banners can't drift.
const AI_DISCLOSURE = 'Dearly is an AI companion — not a real person.';

// useSearchParams() opts the page out of static prerendering unless it sits under
// a Suspense boundary (Next.js CSR-bailout rule).
export default function TalkPage() {
  return (
    <Suspense fallback={<p className="text-center text-base text-muted">Loading…</p>}>
      <TalkEntry />
    </Suspense>
  );
}

function InvalidLink() {
  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="font-display text-3xl font-semibold text-ink">This link isn&rsquo;t valid</h1>
      <p className="mt-4 text-lg text-muted">
        Please open Dearly from the link that was shared with you.
      </p>
    </div>
  );
}

function TalkEntry() {
  const token = useSearchParams().get('token');
  // With a token in the URL we exchange it for an httpOnly cookie first; without
  // one we optimistically proceed (a returning visit relies on that cookie).
  const [state, setState] = useState<'checking' | 'ready' | 'invalid'>(token ? 'checking' : 'ready');

  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .post('/api/talk/auth', { token })
      .then(() => {
        if (!active) return;
        // Drop the raw token from the URL so it doesn't linger in history/logs.
        window.history.replaceState(null, '', '/app/talk');
        setState('ready');
      })
      .catch(() => {
        if (active) setState('invalid');
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (state === 'checking') return <p className="text-center text-base text-muted">Connecting…</p>;
  if (state === 'invalid') return <InvalidLink />;
  return <TalkFlow />;
}

function TalkFlow() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [conversationId, setConversationId] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nextId = useRef(0);
  const add = (role: Role, content: string): number => {
    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, role, content }]);
    return id;
  };
  const removeTurn = (id: number) => setTurns((prev) => prev.filter((t) => t.id !== id));

  async function start() {
    setError('');
    setBusy(true);
    try {
      // Consent first (idempotent) — the session refuses without it. Auth rides
      // on the httpOnly talk cookie set by the /api/talk/auth exchange.
      await api.post('/api/talk/consent');
      const r = await api.post<{ conversation_id: string; greeting: string }>('/api/talk/session');
      setConversationId(r.conversation_id);
      add('kindly', r.greeting);
      setPhase('active');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('This link isn’t valid or has expired. Please open Dearly from a fresh link.');
      } else {
        setError(err instanceof ApiError ? err.message : 'We couldn’t start the conversation.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'intro') {
    return (
      <div className="mx-auto max-w-md text-center">
        <p className="rounded-xl border border-line bg-cloud px-4 py-3 text-base text-muted">
          {AI_DISCLOSURE}
        </p>
        <h1 className="mt-8 font-display text-3xl font-semibold text-ink">Hello 👋</h1>
        <p className="mt-4 text-lg text-muted">
          I&rsquo;m Dearly. I&rsquo;d love to chat with you whenever you like.
        </p>
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="btn-primary mt-10 px-10 py-4 text-xl disabled:opacity-60"
        >
          {busy ? 'One moment…' : 'Start talking'}
        </button>
        {error && <p className="mt-4 text-base text-clay">{error}</p>}
      </div>
    );
  }

  if (phase === 'ended') {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="font-display text-3xl font-semibold text-ink">Take care 💛</h1>
        <p className="mt-4 text-lg text-muted">
          It was lovely talking with you. I&rsquo;ll be here whenever you want to chat again.
        </p>
      </div>
    );
  }

  return (
    <Conversation
      conversationId={conversationId}
      turns={turns}
      add={add}
      removeTurn={removeTurn}
      onEnded={() => setPhase('ended')}
    />
  );
}

function Conversation({
  conversationId,
  turns,
  add,
  removeTurn,
  onEnded,
}: {
  conversationId: string;
  turns: Turn[];
  add: (role: Role, content: string) => number;
  removeTurn: (id: number) => void;
  onEnded: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  // Typing is a fallback, not the primary way to talk to Dearly — shown only
  // when voice genuinely isn't available (unsupported browser, or the parent
  // declined/lost mic access), never alongside a working mic button. Without
  // this, a text box sitting next to "Talk out loud" turns a voice-first
  // conversation into a read-and-type chat by default.
  const [showTextFallback, setShowTextFallback] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Mobile Safari/Chrome only allow audio.play() without a fresh user
  // gesture on an element that a real click has already "unlocked" once —
  // by the time sendVoice() gets a tts_url back, the STT+AI+TTS round trip
  // has burned several seconds and any gesture from the original tap has
  // long expired, so a bare `new Audio(url).play()` there is silently
  // blocked on essentially every real device. Playing a silent clip
  // synchronously inside the tap handler (below) unlocks THIS SAME element
  // for the rest of the session; sendVoice then only ever changes its `src`
  // and replays it, never constructing a fresh Audio object.
  function primeAudioPlayback() {
    if (!audioRef.current) {
      audioRef.current = new Audio(
        'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
      );
    }
    audioRef.current.play().catch(() => {
      /* expected once a previous tap already unlocked it */
    });
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, sending, voiceBusy]);

  // Progressive enhancement: only show the mic button where recording is
  // actually supported (no getUserMedia/MediaRecorder on e.g. older Safari).
  // When it isn't, fall back to typing — better than stranding the parent
  // with no way to talk at all.
  useEffect(() => {
    const supported =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof window.MediaRecorder !== 'undefined';
    setVoiceSupported(supported);
    if (!supported) setShowTextFallback(true);
  }, []);

  async function sendVoice(blob: Blob) {
    setError('');
    setVoiceBusy(true);
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'voice.webm');
      formData.append('conversation_id', conversationId);
      const res = await fetch('/api/talk/voice', { method: 'POST', body: formData });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const message = (payload as { error?: { message?: string } } | null)?.error?.message;
        throw new Error(message ?? 'We couldn’t hear that. Please try again.');
      }
      const { transcript, reply, tts_url: ttsUrl } = payload as {
        transcript: string;
        reply: string;
        tts_url: string;
      };
      add('parent', transcript);
      add('kindly', reply);
      // Reuse the same element primeAudioPlayback() unlocked on tap (see its
      // comment) — a fresh `new Audio(ttsUrl)` here would hit the autoplay
      // block on most real devices. Best-effort even so: the reply is still
      // shown as text either way if playback fails for some other reason.
      try {
        if (!audioRef.current) primeAudioPlayback();
        const audio = audioRef.current!;
        audio.src = ttsUrl;
        await audio.play();
      } catch {
        // ignore — text reply already rendered
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We couldn’t hear that. Please try again.');
    } finally {
      setVoiceBusy(false);
    }
  }

  async function toggleRecording() {
    // Unlock playback synchronously, on the tap itself — before any `await`
    // — on both the start and stop taps (whichever fires first "counts" as
    // the real user gesture; priming again on the second is a harmless
    // no-op). See primeAudioPlayback's comment.
    primeAudioPlayback();
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        void sendVoice(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Please allow microphone access to talk out loud. You can type below in the meantime.');
      setShowTextFallback(true);
    }
  }

  async function send() {
    const content = draft.trim();
    if (!content || sending || ending) return;
    setError('');
    setDraft('');
    const pending = add('parent', content);
    setSending(true);
    try {
      const r = await api.post<{ reply: string }>('/api/talk/message', {
        conversation_id: conversationId,
        content,
      });
      add('kindly', r.reply);
    } catch (err) {
      // The server persists turns only after a successful reply, so on failure
      // roll back the optimistic bubble and restore the draft — otherwise a
      // retry would show the parent's message twice.
      removeTurn(pending);
      setDraft(content);
      setError(err instanceof ApiError ? err.message : 'That didn’t send. Please try again.');
    } finally {
      setSending(false);
    }
  }

  async function end() {
    setError('');
    setEnding(true);
    try {
      await api.post('/api/talk/session/end', { conversation_id: conversationId });
      onEnded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'We couldn’t end the conversation.');
      setEnding(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col">
      <p className="rounded-xl border border-line bg-cloud px-4 py-2 text-center text-sm text-muted">
        {AI_DISCLOSURE}
      </p>

      <div className="mt-6 space-y-4" aria-live="polite">
        {turns.map((t) => (
          <div key={t.id} className={t.role === 'parent' ? 'text-right' : 'text-left'}>
            <span
              className={`inline-block max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-3 text-lg ${
                t.role === 'parent' ? 'bg-sage text-cloud' : 'border border-line bg-cloud text-ink'
              }`}
            >
              {t.content}
            </span>
          </div>
        ))}
        {sending && <p className="text-left text-base text-muted">Dearly is thinking…</p>}
        {voiceBusy && <p className="text-left text-base text-muted">Dearly is listening…</p>}
        <div ref={endRef} />
      </div>

      {error && <p className="mt-4 text-base text-clay">{error}</p>}

      {voiceSupported && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={toggleRecording}
            disabled={sending || ending || voiceBusy}
            aria-pressed={recording}
            className={`inline-flex min-h-[5rem] items-center justify-center gap-3 rounded-2xl px-12 text-2xl font-semibold transition-colors disabled:opacity-60 ${
              recording ? 'bg-clay text-cloud' : 'btn-primary'
            }`}
          >
            {recording ? '⏹ Tap to stop' : '🎤 Talk out loud'}
          </button>
        </div>
      )}

      {showTextFallback && (
        <div className="mt-6 flex flex-col gap-3">
          {!voiceSupported && (
            <p className="text-center text-sm text-muted">
              Voice isn’t available on this browser, so you can type instead.
            </p>
          )}
          <label htmlFor="talk-input" className="sr-only">
            Your message
          </label>
          <textarea
            id="talk-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Type your message…"
            className="w-full resize-none rounded-xl border border-line bg-mist px-4 py-3 text-lg text-ink focus:border-sage"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={send}
              disabled={sending || ending || recording || voiceBusy || !draft.trim()}
              className="btn-primary px-8 py-3 text-lg disabled:opacity-60"
            >
              Send
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 flex justify-center">
        <button
          type="button"
          onClick={end}
          disabled={ending || sending}
          className="text-base text-muted underline disabled:opacity-60"
        >
          {ending ? 'Ending…' : 'I’m done for now'}
        </button>
      </div>
    </div>
  );
}
