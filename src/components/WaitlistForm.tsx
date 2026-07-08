'use client';

import { useState } from 'react';

type Status = 'idle' | 'submitting' | 'done' | 'error';

export function WaitlistForm({ sourcePage = '/waitlist' }: { sourcePage?: string }) {
  const [email, setEmail] = useState('');
  const [wantsDemo, setWantsDemo] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit() {
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
      <div className="rounded-xl border border-line bg-cloud p-6 text-lg text-ink">{message}</div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="wl-email" className="block text-base font-semibold text-ink">
          Your email
        </label>
        <input
          id="wl-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-2 w-full rounded-xl border border-line bg-cloud px-4 py-3 text-lg text-ink focus:border-sage"
          placeholder="you@example.com"
        />
      </div>
      <label className="flex items-center gap-3 text-base text-ink">
        <input
          type="checkbox"
          checked={wantsDemo}
          onChange={(e) => setWantsDemo(e.target.checked)}
          className="h-5 w-5 rounded border-line"
        />
        I’d also like a quick demo
      </label>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={status === 'submitting'}
        className="btn-primary w-full disabled:opacity-60"
      >
        {status === 'submitting' ? 'Joining…' : 'Join the waitlist'}
      </button>
      {status === 'error' && <p className="text-base text-clay">{message}</p>}
      <p className="text-sm text-muted">
        We’ll only use your email to contact you about Kindly. No spam, ever.
      </p>
    </div>
  );
}
