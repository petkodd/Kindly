'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/apiClient';
import {
  expiredLinkMessage,
  mapTalkError,
  type LinkOwner,
  type TalkContext,
  type TalkFailure,
  type TalkProblem,
} from '@/lib/talk/errors';
import { MAX_RECORDING_MS, pickRecordingMimeType, uploadFileFor } from '@/lib/talk/recording';
import { PARENT_CONVERSATION_NOTICE, type SummarySharingNoticePayload } from '@/lib/talk/notices';

type Phase = 'intro' | 'notice' | 'active' | 'ended';
type Role = 'parent' | 'kindly';
type Mode = 'voice' | 'text';
interface Turn {
  id: number;
  role: Role;
  content: string;
}

interface TalkSettings {
  large_text: boolean;
  voice_first: boolean;
  speech_rate: 'slow' | 'normal';
  language: string;
}

interface SessionResponse {
  conversation_id: string;
  greeting: string;
  greeting_audio_url?: string | null;
  settings?: TalkSettings;
  family_first_name?: string | null;
  link_owner?: LinkOwner;
  summary_notice?: SummarySharingNoticePayload | null;
}

// Profile defaults (db/migrations/0001_init.sql) until the session says otherwise.
const DEFAULT_SETTINGS: TalkSettings = { large_text: true, voice_first: true, speech_rate: 'slow', language: 'en-US' };

// Compliance-sensitive: Dearly must disclose it's an AI. Single-sourced (with
// the rest of the intro text, which /api/talk/consent stores with the consent)
// so the intro and in-conversation banners can't drift. The spoken greeting
// from /api/talk/session says the same thing out loud.
const AI_DISCLOSURE = PARENT_CONVERSATION_NOTICE.disclosure;

// Accessible name of the talk button. Fixed on purpose: its on/off state is
// carried by aria-pressed alone, so a screen reader hears one stable control.
const TALK_BUTTON_LABEL = 'Talk to Dearly';

// A silent WAV used to unlock audio playback inside a real tap (see primeAudio).
const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** Turn any thrown value into the failure shape the error map understands. */
function toFailure(err: unknown): TalkFailure {
  if (err instanceof ApiError) return { status: err.status, code: err.code };
  if (err instanceof HttpFailure) return { status: err.status, code: err.code };
  return { network: true };
}

class HttpFailure extends Error {
  constructor(
    public status: number,
    public code?: string,
  ) {
    super(`HTTP ${status}`);
  }
}

// useSearchParams() opts the page out of static prerendering unless it sits under
// a Suspense boundary (Next.js CSR-bailout rule).
export default function TalkPage() {
  return (
    <Suspense fallback={<p className="text-center text-lg text-muted">Loading…</p>}>
      <TalkEntry />
    </Suspense>
  );
}

function InvalidLink() {
  return (
    <div className="mx-auto max-w-md text-center">
      <h1 className="font-display text-3xl font-semibold text-ink">This link isn&rsquo;t working</h1>
      <p className="mt-4 text-xl text-ink">{expiredLinkMessage()}</p>
    </div>
  );
}

function TalkEntry() {
  const token = useSearchParams().get('token');
  // With a token in the URL we exchange it for an httpOnly cookie first; without
  // one we optimistically proceed (a returning visit relies on that cookie).
  const [state, setState] = useState<'checking' | 'ready' | 'invalid'>(token ? 'checking' : 'ready');
  const [context, setContext] = useState<TalkContext>({});

  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .post<{ ok: true; family_first_name?: string | null; link_owner?: LinkOwner }>('/api/talk/auth', { token })
      .then((r) => {
        if (!active) return;
        // Drop the raw token from the URL so it doesn't linger in history/logs.
        window.history.replaceState(null, '', '/app/talk');
        setContext({ familyFirstName: r?.family_first_name ?? null, linkOwner: r?.link_owner });
        setState('ready');
      })
      .catch(() => {
        if (active) setState('invalid');
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (state === 'checking') return <p className="text-center text-lg text-muted">Connecting…</p>;
  if (state === 'invalid') return <InvalidLink />;
  return <TalkFlow initialContext={context} />;
}

function TalkFlow({ initialContext }: { initialContext: TalkContext }) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [conversationId, setConversationId] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<TalkProblem | null>(null);
  const [settings, setSettings] = useState<TalkSettings>(DEFAULT_SETTINGS);
  const [context, setContext] = useState<TalkContext>(initialContext);
  const [notice, setNotice] = useState<SummarySharingNoticePayload | null>(null);
  const [greeting, setGreeting] = useState<{ text: string; audioUrl: string | null } | null>(null);
  const nextId = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const add = useCallback((role: Role, content: string): number => {
    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, role, content }]);
    return id;
  }, []);
  const removeTurn = useCallback((id: number) => setTurns((prev) => prev.filter((t) => t.id !== id)), []);

  // Mobile Safari/Chrome only allow audio.play() without a fresh user gesture
  // on an element a real tap has already "unlocked". A reply arrives seconds
  // after the tap (STT + AI + TTS), when the gesture has long expired, so a
  // fresh `new Audio(url).play()` is silently blocked on most real devices.
  // Playing a silent clip synchronously inside each tap unlocks THIS element
  // for the session; every later sound only changes its `src`.
  const primeAudio = useCallback(() => {
    if (typeof Audio === 'undefined') return;
    if (!audioRef.current) audioRef.current = new Audio(SILENT_WAV);
    audioRef.current.play()?.catch?.(() => {
      /* expected once a previous tap already unlocked it */
    });
  }, []);

  const playAudio = useCallback(
    async (url: string | null | undefined) => {
      if (!url) return;
      // Best-effort: the words are always shown on screen as well.
      try {
        if (!audioRef.current) primeAudio();
        const audio = audioRef.current;
        if (!audio) return;
        audio.src = url;
        await audio.play();
      } catch {
        // ignore — the text is already rendered
      }
    },
    [primeAudio],
  );

  async function start() {
    // Unlock audio on this tap, before any await, so the greeting can be heard.
    primeAudio();
    setProblem(null);
    setBusy(true);
    try {
      // Consent first (idempotent) — the session refuses without it. Auth rides
      // on the httpOnly talk cookie set by the /api/talk/auth exchange.
      await api.post('/api/talk/consent');
      const r = await api.post<SessionResponse>('/api/talk/session');
      setConversationId(r.conversation_id);
      if (r.settings) setSettings({ ...DEFAULT_SETTINGS, ...r.settings });
      if (r.family_first_name !== undefined || r.link_owner) {
        setContext((prev) => ({
          familyFirstName: r.family_first_name ?? prev.familyFirstName ?? null,
          linkOwner: r.link_owner ?? prev.linkOwner,
        }));
      }
      nextId.current = 0;
      setTurns([]);
      if (r.summary_notice) {
        // Chat 9: the parent hears and reads the summary-sharing notice and
        // answers it before the conversation starts.
        setGreeting({ text: r.greeting, audioUrl: r.greeting_audio_url ?? null });
        setNotice(r.summary_notice);
        setPhase('notice');
        void playAudio(r.summary_notice.audio_url);
        return;
      }
      add('kindly', r.greeting);
      setPhase('active');
      void playAudio(r.greeting_audio_url);
    } catch (err) {
      setProblem(mapTalkError(toFailure(err), context));
    } finally {
      setBusy(false);
    }
  }

  async function answerNotice(answer: 'yes' | 'not_now') {
    if (!notice) return;
    primeAudio();
    setProblem(null);
    setBusy(true);
    try {
      await api.post('/api/talk/consent/summary', { answer, version: notice.version, text: notice.text });
      if (greeting) add('kindly', greeting.text);
      setNotice(null);
      setPhase('active');
      void playAudio(greeting?.audioUrl);
    } catch (err) {
      // The notice changed since it was shown (e.g. someone new was invited):
      // show the new words and ask again. Nothing was recorded.
      if (err instanceof ApiError && err.code === 'notice_changed') {
        const fresh = (err.body as { summary_notice?: SummarySharingNoticePayload } | undefined)?.summary_notice;
        if (fresh) setNotice(fresh);
        setProblem({
          kind: 'went_wrong',
          message: 'I updated the note above. Please have a look and answer again.',
          canType: false,
          canRetry: false,
        });
      } else {
        setProblem(mapTalkError(toFailure(err), context));
      }
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'notice' && notice) {
    return (
      <SummaryNotice
        notice={notice}
        busy={busy}
        largeText={settings.large_text}
        problem={problem}
        onAnswer={answerNotice}
      />
    );
  }

  if (phase === 'intro' || phase === 'ended') {
    const ended = phase === 'ended';
    return (
      <div className={`mx-auto max-w-md text-center ${settings.large_text ? 'text-xl' : 'text-lg'}`}>
        {!ended && (
          <p className="rounded-xl border border-line bg-cloud px-4 py-3 text-lg text-ink">{AI_DISCLOSURE}</p>
        )}
        <h1 className="mt-8 font-display text-3xl font-semibold text-ink sm:text-4xl">
          {ended ? 'Take care' : 'Hello'}
        </h1>
        <p className="mt-4 text-ink">
          {ended
            ? 'It was lovely talking with you. I’ll be here whenever you want to chat again.'
            : PARENT_CONVERSATION_NOTICE.invite}
        </p>
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="btn-primary mt-10 min-h-[4.5rem] w-full px-10 text-2xl disabled:opacity-60 sm:w-auto"
        >
          {busy ? 'One moment…' : ended ? 'Talk again' : 'Start talking'}
        </button>
        {problem && <ProblemNotice problem={problem} />}
      </div>
    );
  }

  return (
    <Conversation
      conversationId={conversationId}
      turns={turns}
      add={add}
      removeTurn={removeTurn}
      settings={settings}
      context={context}
      primeAudio={primeAudio}
      playAudio={playAudio}
      onEnded={() => setPhase('ended')}
    />
  );
}

/**
 * The one-time summary-sharing notice (chat 9). Shown and spoken before the
 * conversation, with two large answers. The safety sentence in it is not
 * optional (D2): the parent can say "Not now" to weekly notes, but is always
 * told who is alerted if they seem to be in danger.
 */
function SummaryNotice({
  notice,
  busy,
  largeText,
  problem,
  onAnswer,
}: {
  notice: SummarySharingNoticePayload;
  busy: boolean;
  largeText: boolean;
  problem: TalkProblem | null;
  onAnswer: (answer: 'yes' | 'not_now') => void;
}) {
  return (
    <section
      aria-labelledby="summary-notice-title"
      className={`mx-auto max-w-xl text-center ${largeText ? 'text-xl' : 'text-lg'}`}
    >
      <p className="rounded-xl border border-line bg-cloud px-4 py-3 text-lg text-ink">{AI_DISCLOSURE}</p>
      <h1 id="summary-notice-title" className="mt-8 font-display text-3xl font-semibold text-ink sm:text-4xl">
        Before we chat
      </h1>
      <p className="mt-6 text-left text-2xl leading-relaxed text-ink sm:text-center">{notice.text}</p>
      <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => onAnswer('yes')}
          disabled={busy}
          className="btn-primary min-h-[4.5rem] w-full px-10 text-2xl disabled:opacity-60 sm:w-auto"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onAnswer('not_now')}
          disabled={busy}
          className="min-h-[4.5rem] w-full rounded-full border-2 border-sageDeep bg-cloud px-10 text-2xl font-semibold text-ink disabled:opacity-60 sm:w-auto"
        >
          Not now
        </button>
      </div>
      {busy && <p className="mt-4 text-lg text-muted">One moment…</p>}
      {problem && <ProblemNotice problem={problem} />}
    </section>
  );
}

function ProblemNotice({ problem, children }: { problem: TalkProblem; children?: React.ReactNode }) {
  return (
    <div role="alert" className="mt-6 rounded-2xl border-2 border-sageDeep bg-cloud px-5 py-4 text-left">
      <p className="text-xl text-ink">{problem.message}</p>
      {children && <div className="mt-4 flex flex-col gap-3 sm:flex-row">{children}</div>}
    </div>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

function Conversation({
  conversationId,
  turns,
  add,
  removeTurn,
  settings,
  context,
  primeAudio,
  playAudio,
  onEnded,
}: {
  conversationId: string;
  turns: Turn[];
  add: (role: Role, content: string) => number;
  removeTurn: (id: number) => void;
  settings: TalkSettings;
  context: TalkContext;
  primeAudio: () => void;
  playAudio: (url: string | null | undefined) => Promise<void>;
  onEnded: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const [problem, setProblem] = useState<TalkProblem | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  // null until we know whether this browser can record at all.
  const [voiceSupported, setVoiceSupported] = useState<boolean | null>(null);
  // Voice is the way in; typing is a fallback the parent can always reach
  // after a problem, and the starting mode only when the profile says
  // voice_first = false or the browser can't record.
  const [mode, setMode] = useState<Mode>('voice');
  const endRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBlobRef = useRef<Blob | null>(null);
  const discardRef = useRef(false);

  const big = settings.large_text;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [turns, sending, voiceBusy, problem]);

  // Progressive enhancement: only offer the mic where recording is actually
  // supported (no getUserMedia/MediaRecorder on e.g. older Safari).
  useEffect(() => {
    const supported =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof window.MediaRecorder !== 'undefined';
    setVoiceSupported(supported);
    setMode(supported && settings.voice_first ? 'voice' : 'text');
    // settings arrive with the session before this component mounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const releaseMic = useCallback(() => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Leaving the page mid-recording must not keep the microphone on, and must
  // not upload a half-finished clip.
  useEffect(() => {
    // Reset on (re)mount: React StrictMode mounts, unmounts and remounts in
    // development, and a flag left `true` by that first cleanup would silently
    // drop every recording.
    discardRef.current = false;
    return () => {
      discardRef.current = true;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* already stopped */
        }
      }
      releaseMic();
    };
  }, [releaseMic]);

  async function sendVoice(blob: Blob) {
    setProblem(null);
    setVoiceBusy(true);
    lastBlobRef.current = blob;
    try {
      const { filename, type } = uploadFileFor(blob.type);
      const formData = new FormData();
      formData.append('audio', new Blob([blob], { type }), filename);
      formData.append('conversation_id', conversationId);
      const res = await fetch('/api/talk/voice', { method: 'POST', body: formData });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (payload as { error?: { code?: string } } | null)?.error?.code;
        throw new HttpFailure(res.status, code);
      }
      const { transcript, reply, tts_url: ttsUrl } = payload as {
        transcript: string;
        reply: string;
        tts_url: string;
      };
      lastBlobRef.current = null;
      add('parent', transcript);
      add('kindly', reply);
      await playAudio(ttsUrl);
    } catch (err) {
      setProblem(mapTalkError(toFailure(err), context));
    } finally {
      setVoiceBusy(false);
    }
  }

  function stopRecording() {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    setRecording(false);
  }

  async function startRecording() {
    setProblem(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const chosen = pickRecordingMimeType(
        typeof MediaRecorder.isTypeSupported === 'function'
          ? (t: string) => MediaRecorder.isTypeSupported(t)
          : null,
      );
      const recorder = chosen ? new MediaRecorder(stream, { mimeType: chosen }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        releaseMic();
        if (discardRef.current) return;
        // The recorder's own mimeType is what was really produced (Safari may
        // pick MP4 even when asked otherwise).
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || chosen || 'audio/webm' });
        void sendVoice(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      // A forgotten tap must not record forever.
      stopTimerRef.current = setTimeout(stopRecording, MAX_RECORDING_MS);
    } catch {
      releaseMic();
      setProblem(mapTalkError({ micDenied: true }, context));
    }
  }

  function toggleRecording() {
    // Unlock playback on the tap itself, before any await (see primeAudio).
    primeAudio();
    if (recording) stopRecording();
    else void startRecording();
  }

  function retry() {
    primeAudio();
    const blob = lastBlobRef.current;
    if (problem && (problem.kind === 'offline' || problem.kind === 'went_wrong') && blob && mode === 'voice') {
      void sendVoice(blob);
      return;
    }
    setProblem(null);
    if (mode === 'voice' && problem?.kind !== 'too_many') void startRecording();
    if (mode === 'text' && draft.trim()) void send();
  }

  function switchToText() {
    setProblem(null);
    lastBlobRef.current = null;
    setMode('text');
  }

  function switchToVoice() {
    setProblem(null);
    setMode('voice');
  }

  async function send() {
    const content = draft.trim();
    if (!content || sending || ending) return;
    setProblem(null);
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
      setProblem(mapTalkError(toFailure(err), context));
    } finally {
      setSending(false);
    }
  }

  async function end() {
    setProblem(null);
    if (recording) {
      discardRef.current = true;
      stopRecording();
    }
    setEnding(true);
    try {
      await api.post('/api/talk/session/end', { conversation_id: conversationId });
      onEnded();
    } catch (err) {
      setProblem(mapTalkError(toFailure(err), context));
      setEnding(false);
      discardRef.current = false;
    }
  }

  const thinking = sending || voiceBusy;
  const textSize = big ? 'text-2xl' : 'text-xl';
  // When a problem is on screen it says what to do; don't stack a second hint above it.
  const statusText = problem
    ? ''
    : recording
    ? 'I’m listening. Tap the button again when you’re done.'
    : thinking
      ? 'Dearly is thinking…'
      : mode === 'voice'
        ? 'Tap the button and start talking.'
        : '';

  return (
    <div className="mx-auto flex max-w-xl flex-col">
      <p className="rounded-xl border border-line bg-cloud px-4 py-3 text-center text-lg text-ink">{AI_DISCLOSURE}</p>

      <div className="mt-6 space-y-4">
        {turns.map((t) => (
          <div key={t.id} className={t.role === 'parent' ? 'text-right' : 'text-left'}>
            <span
              className={`inline-block max-w-[90%] whitespace-pre-line rounded-2xl px-5 py-4 leading-snug ${textSize} ${
                t.role === 'parent' ? 'bg-sageDeep text-cloud' : 'border border-line bg-cloud text-ink'
              }`}
            >
              {t.content}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <p aria-live="polite" className={`mt-6 min-h-[2rem] text-center text-ink ${big ? 'text-xl' : 'text-lg'}`}>
        {statusText}
      </p>

      {problem && (
        <ProblemNotice problem={problem}>
          {problem.canRetry && (
            <button
              type="button"
              onClick={retry}
              disabled={thinking || ending}
              className="btn-primary min-h-[3.5rem] px-8 text-xl disabled:opacity-60"
            >
              Try again
            </button>
          )}
          {problem.canType && mode === 'voice' && (
            <button
              type="button"
              onClick={switchToText}
              className="btn-secondary min-h-[3.5rem] px-8 text-xl"
            >
              Type instead
            </button>
          )}
        </ProblemNotice>
      )}

      {mode === 'voice' && voiceSupported && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={toggleRecording}
            disabled={thinking || ending}
            aria-pressed={recording}
            aria-label={TALK_BUTTON_LABEL}
            className={`inline-flex min-h-[6rem] w-full max-w-sm items-center justify-center gap-3 whitespace-nowrap rounded-3xl px-6 text-2xl sm:gap-4 sm:px-8 font-semibold text-cloud shadow-sm transition-colors focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-sageDeep disabled:opacity-60 ${
              recording ? 'bg-sageDeep ring-8 ring-sage/40' : 'bg-sage hover:bg-sageDeep'
            }`}
          >
            {recording ? (
              // While listening, a pulsing dot takes the icon's place (same box, so the label never moves).
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center">
                <span className="h-5 w-5 animate-pulse rounded-full bg-cloud" />
              </span>
            ) : (
              <MicIcon className="h-9 w-9 shrink-0" />
            )}
            <span>{TALK_BUTTON_LABEL}</span>
          </button>
        </div>
      )}

      {mode === 'text' && (
        <form
          className="mt-6 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          {voiceSupported === false && (
            <p className="text-center text-lg text-ink">Voice isn’t available on this device, so you can type instead.</p>
          )}
          <label htmlFor="talk-input" className="text-lg font-semibold text-ink">
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
            rows={3}
            placeholder="Type here…"
            className={`w-full resize-none rounded-xl border-2 border-muted bg-cloud px-4 py-3 text-ink focus:border-sageDeep focus:outline-none ${textSize}`}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            {voiceSupported && (
              <button type="button" onClick={switchToVoice} className="btn-secondary min-h-[3.5rem] px-8 text-xl">
                Use my voice instead
              </button>
            )}
            <button
              type="submit"
              disabled={sending || ending || !draft.trim()}
              className="btn-primary min-h-[3.5rem] px-10 text-xl disabled:opacity-60"
            >
              Send
            </button>
          </div>
        </form>
      )}

      <div className="mt-10 flex justify-center">
        <button
          type="button"
          onClick={end}
          disabled={ending || thinking}
          className="btn-secondary min-h-[3.5rem] px-8 text-xl disabled:opacity-60"
        >
          {ending ? 'Ending…' : 'I’m done for now'}
        </button>
      </div>
    </div>
  );
}
