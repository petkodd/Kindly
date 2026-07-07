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

// Compliance-sensitive: Kindly must disclose it's an AI. Single-sourced so the
// intro and in-conversation banners can't drift.
const AI_DISCLOSURE = 'Kindly is an AI companion — not a real person.';

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
        Please open Kindly from the link that was shared with you.
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
        setError('This link isn’t valid or has expired. Please open Kindly from a fresh link.');
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
          I&rsquo;m Kindly. I&rsquo;d love to chat with you whenever you like.
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
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, sending]);

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
        {sending && <p className="text-left text-base text-muted">Kindly is thinking…</p>}
        <div ref={endRef} />
      </div>

      {error && <p className="mt-4 text-base text-clay">{error}</p>}

      <div className="mt-6 flex flex-col gap-3">
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
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={end}
            disabled={ending || sending}
            className="text-base text-muted underline disabled:opacity-60"
          >
            {ending ? 'Ending…' : 'I’m done for now'}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || ending || !draft.trim()}
            className="btn-primary px-8 py-3 text-lg disabled:opacity-60"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
