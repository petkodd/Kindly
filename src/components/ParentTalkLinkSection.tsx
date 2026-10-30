'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/apiClient';

interface LinkStatus {
  active: boolean;
  created_at: string | null;
  expires_at: string | null;
}

export const TALK_LINK_SECTION_ID = 'talk-link';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
}

/**
 * Large-type, printable instructions for the parent: a one-page card with
 * their link and three steps. Built as a standalone page in a new window so
 * the print contains only the card (no app chrome). Exported for tests.
 */
export function instructionCardHtml(firstName: string, talkUrl: string): string {
  const name = escapeHtml(firstName);
  const url = escapeHtml(talkUrl);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>How to talk with Dearly</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#1f2a24;margin:0;padding:48px;}
  h1{font-size:44px;margin:0 0 24px;}
  p,li{font-size:28px;line-height:1.5;}
  ol{padding-left:40px;}
  .url{font-family:'Courier New',monospace;font-size:22px;word-break:break-all;border:3px solid #1f2a24;border-radius:12px;padding:16px;margin:24px 0;}
  .note{font-size:20px;color:#444;margin-top:32px;}
  @media print{body{padding:24px;}}
</style></head><body>
<h1>Hello ${name}, here is how to talk with Dearly</h1>
<ol>
  <li>On your tablet, phone or computer, open the web browser.</li>
  <li>Type in this address exactly, or ask a family member to open it for you:</li>
</ol>
<p class="url">${url}</p>
<ol start="3">
  <li>Press the big button and start talking. Dearly is an AI companion — a computer, not a person — and it is always happy to chat.</li>
</ol>
<p>Tip: once it is open, add it to your home screen or bookmarks so it is one tap away next time.</p>
<p class="note">This address is private to you. Please don’t share it. If it is lost, your family can make a new one.</p>
</body></html>`;
}

/**
 * "Parent's talk link" on the parent profile (chat 10), for every
 * relationship type. The buyer can make a new link (which revokes the old
 * one), turn the link off, copy it, email it to themselves and print a
 * large-type instruction card. Raw tokens are never stored server-side, so an
 * existing link can't be shown again — making a new one is the way to get a
 * copyable link back. The buyer's "Talk link" nav item jumps here.
 */
export function ParentTalkLinkSection({ parentId, firstName }: { parentId: string; firstName: string }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'' | 'create' | 'revoke' | 'email'>('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);

  const talkUrl = token && typeof window !== 'undefined' ? `${window.location.origin}/app/talk?token=${token}` : '';

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.get<LinkStatus>(`/api/parents/${parentId}/access-link`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check the talk link.');
    }
  }, [parentId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Arriving via the nav item (/app/parent-profile#talk-link): the section
  // renders after data loads, so the browser's own hash jump has already
  // missed it — scroll once it exists.
  useEffect(() => {
    if (status && typeof window !== 'undefined' && window.location.hash === `#${TALK_LINK_SECTION_ID}`) {
      sectionRef.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [status]);

  async function createLink() {
    if (status?.active && !window.confirm(`Make a new link for ${firstName}? The current link will stop working straight away.`)) return;
    setError('');
    setNote('');
    setBusy('create');
    try {
      const r = await api.post<{ token: string }>(`/api/parents/${parentId}/access-link`);
      setToken(r.token);
      setNote(status?.active ? 'New link made. The old link no longer works.' : 'Link made.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not make a new link. Please try again.');
    } finally {
      setBusy('');
    }
  }

  async function revoke() {
    if (!window.confirm(`Turn off ${firstName}'s talk link? They won't be able to talk with Dearly until you make a new one.`)) return;
    setError('');
    setNote('');
    setBusy('revoke');
    try {
      await api.post(`/api/parents/${parentId}/access-link/revoke`);
      setToken('');
      setNote('The talk link is turned off. Make a new link whenever you’re ready.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not turn off the link. Please try again.');
    } finally {
      setBusy('');
    }
  }

  async function copy() {
    setError('');
    try {
      await navigator.clipboard.writeText(talkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copying isn’t available here. Select the link above and copy it by hand.');
    }
  }

  async function emailMe() {
    setError('');
    setNote('');
    setBusy('email');
    try {
      const r = await api.post<{ sent_to: string }>(`/api/parents/${parentId}/access-link/email`, { token });
      setNote(`Sent to ${r.sent_to}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the email. Please try again.');
    } finally {
      setBusy('');
    }
  }

  function printCard() {
    setError('');
    const w = window.open('', '_blank');
    if (!w) {
      setError('Your browser blocked the print window. Allow pop-ups for this site and try again.');
      return;
    }
    w.document.write(instructionCardHtml(firstName, talkUrl));
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <section
      ref={sectionRef}
      id={TALK_LINK_SECTION_ID}
      aria-labelledby={`${TALK_LINK_SECTION_ID}-heading`}
      className="scroll-mt-6 rounded-xl border border-line bg-cloud p-6"
    >
      <h2 id={`${TALK_LINK_SECTION_ID}-heading`} className="text-lg font-semibold text-ink">
        {firstName}&rsquo;s talk link
      </h2>
      <p className="mt-2 text-base text-muted">
        {firstName} opens this private link to talk with Dearly — no password needed. Make a new one any time; the old
        one stops working straight away.
      </p>

      {!status ? (
        <p className="mt-4 text-base text-muted">Checking the link…</p>
      ) : (
        <p className="mt-4 text-base font-semibold text-ink" role="status">
          {status.active
            ? ['A link is active.', status.created_at && `Made ${fmtDate(status.created_at)}.`, status.expires_at && `Works until ${fmtDate(status.expires_at)}.`]
                .filter(Boolean)
                .join(' ')
            : 'There’s no active link right now.'}
        </p>
      )}

      {talkUrl ? (
        <div className="mt-4 space-y-3 rounded-lg border border-line bg-mist p-4">
          <p className="text-base font-semibold text-ink">Save or share it now — for privacy we can&rsquo;t show it again:</p>
          <code data-testid="talk-url" className="block break-all rounded-lg bg-cloud px-3 py-2 text-sm text-ink">
            {talkUrl}
          </code>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={copy} className="btn-secondary">
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" onClick={emailMe} disabled={busy !== ''} className="btn-secondary disabled:opacity-60">
              {busy === 'email' ? 'Sending…' : 'Email it to me'}
            </button>
            <button type="button" onClick={printCard} className="btn-secondary">
              Print instruction card
            </button>
          </div>
        </div>
      ) : (
        status?.active && (
          <p className="mt-2 text-base text-muted">
            To copy, email or print the link, make a new one — we only ever show a link once.
          </p>
        )
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={createLink} disabled={busy !== ''} className="btn-primary disabled:opacity-60">
          {busy === 'create' ? 'Making…' : status?.active ? 'Make a new link' : 'Make a talk link'}
        </button>
        {status?.active && (
          <button type="button" onClick={revoke} disabled={busy !== ''} className="btn-secondary disabled:opacity-60">
            {busy === 'revoke' ? 'Turning off…' : 'Turn off link'}
          </button>
        )}
      </div>

      {note && (
        <p role="status" className="mt-3 text-base text-muted">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-base text-clay">
          {error}
        </p>
      )}
    </section>
  );
}
