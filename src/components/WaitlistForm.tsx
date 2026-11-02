'use client';

import { useState, type FormEvent } from 'react';
import { FormStatus } from '@/components/FormStatus';
import { checkCls, inputOnPageCls, labelCls } from '@/lib/formStyles';

type Status = 'idle' | 'submitting' | 'done' | 'error';

export function WaitlistForm({ sourcePage = '/waitlist' }: { sourcePage?: string }) {
  const [email, setEmail] = useState('');
  const [wantsDemo, setWantsDemo] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    if (!email.includes('@')) {
      setStatus('error');
      setMessage('Please enter a valid email address.');
      return;
    }
    setStatus('submitting');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, wants_demo: wantsDemo, source_page: sourcePage }),
      });
      if (!res.ok) throw new Error('Request failed');
      setStatus('done');
      setMessage('You’re on the list. We’ll be in touch soon.');
    } catch {
      setStatus('error');
      setMessage('Something went wrong. Please try again.');
    }
  }

  if (status === 'done') {
    return (
      <div role="status" aria-live="polite" className="rounded-xl border border-line bg-cloud p-6 text-lg text-ink">
        {message}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div>
        <label htmlFor="wl-email" className={labelCls}>
          Your email
        </label>
        <input
          id="wl-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={status === 'error' ? true : undefined}
          aria-describedby={status === 'error' ? 'wl-error' : undefined}
          className={`mt-2 ${inputOnPageCls}`}
          placeholder="you@example.com"
        />
      </div>
      <label className="flex min-h-[2.75rem] items-center gap-3 text-base text-ink">
        <input
          type="checkbox"
          checked={wantsDemo}
          onChange={(e) => setWantsDemo(e.target.checked)}
          className={checkCls}
        />
        I’d also like a quick demo
      </label>
      <button
        type="submit"
        disabled={status === 'submitting'}
        className="btn-primary w-full disabled:opacity-60"
      >
        {status === 'submitting' ? 'Joining…' : 'Join the waitlist'}
      </button>
      <FormStatus kind="error" id="wl-error" message={status === 'error' ? message : ''} />
      <p className="text-base text-muted">
        We’ll only use your email to contact you about Dearly. No spam, ever.
      </p>
    </form>
  );
}
