'use client';

import { useRef, useState, type FormEvent } from 'react';
import { FormStatus } from '@/components/FormStatus';
import { inputOnPageCls, labelCls } from '@/lib/formStyles';
import { EMAIL_RE } from '@/lib/validation';

type Status = 'idle' | 'submitting' | 'done' | 'error';

/**
 * Email-only updates list (POST /api/waitlist). Chat 13: a real <form> with
 * the same email check as the server (EMAIL_RE), and copy set by the caller
 * — "Get updates" on /waitlist, "Email me new posts" on the blog. The
 * consumer product is on sale, so this is never the primary buy CTA.
 */
export function WaitlistForm({
  sourcePage = '/waitlist',
  submitLabel = 'Get updates',
  doneMessage = 'Thank you. You’re on the list, and we’ll be in touch.',
}: {
  sourcePage?: string;
  submitLabel?: string;
  doneMessage?: string;
}) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value) || value.length > 320) {
      setStatus('error');
      setMessage('Please enter a valid email address, like name@example.com.');
      inputRef.current?.focus();
      return;
    }
    setStatus('submitting');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, source_page: sourcePage }),
      });
      if (res.status === 429) throw new Error('Too many requests. Please try again in a little while.');
      if (res.status === 400) throw new Error('Please enter a valid email address, like name@example.com.');
      if (!res.ok) throw new Error('Something went wrong. Please try again.');
      setStatus('done');
      setMessage(doneMessage);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.');
    }
  }

  if (status === 'done') {
    return <FormStatus kind="success" message={message} />;
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={submitLabel} className="space-y-5">
      <div>
        <label htmlFor="wl-email" className={labelCls}>
          Your email
        </label>
        <input
          ref={inputRef}
          id="wl-email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={status === 'error' ? true : undefined}
          aria-describedby={status === 'error' ? 'wl-error' : undefined}
          className={`mt-2 ${inputOnPageCls}`}
          placeholder="you@example.com"
        />
      </div>
      <button type="submit" disabled={status === 'submitting'} className="btn-primary w-full disabled:opacity-60">
        {status === 'submitting' ? 'Sending…' : submitLabel}
      </button>
      <FormStatus kind="error" id="wl-error" message={status === 'error' ? message : ''} />
      <p className="text-base text-muted">We’ll only use your email to contact you about Dearly. No spam, ever.</p>
    </form>
  );
}
