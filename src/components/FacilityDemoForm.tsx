'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { FormStatus } from '@/components/FormStatus';
import { fieldErrorCls, helpCls, inputOnPageCls, labelCls } from '@/lib/formStyles';
import { DEMO_MAX_RESIDENTS, DEMO_ROLES, validateDemoRequest, type DemoField } from '@/lib/demoRequest';

type Status = 'idle' | 'submitting' | 'done' | 'error';
type Values = Record<DemoField, string>;

const EMPTY: Values = { facility_name: '', residents: '', role: '', name: '', email: '', phone: '' };

/**
 * Facility demo request form for /senior-living (chat 13). Posts to
 * /api/demo, which stores the request and emails sales. Validation runs with
 * the same rules as the server (src/lib/demoRequest.ts); each invalid field
 * gets aria-invalid plus its own message, and focus moves to the first one.
 */
export function FacilityDemoForm({ sourcePage = '/senior-living' }: { sourcePage?: string }) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<DemoField, string>>>({});
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');

  const set = (field: DemoField) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: e.target.value }));

  function focusFirst(errs: Partial<Record<DemoField, string>>) {
    const first = (Object.keys(EMPTY) as DemoField[]).find((f) => errs[f]);
    if (first) document.getElementById(`demo-${first}`)?.focus();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const checked = validateDemoRequest(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      setStatus('error');
      setMessage('Please check the highlighted fields.');
      focusFirst(checked.errors);
      return;
    }
    setErrors({});
    setStatus('submitting');
    setMessage('');
    try {
      const res = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, source_page: sourcePage }),
      });
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { error?: { fields?: Partial<Record<DemoField, string>> } } | null;
        const fields = body?.error?.fields ?? {};
        setErrors(fields);
        setStatus('error');
        setMessage('Please check the highlighted fields.');
        focusFirst(fields);
        return;
      }
      if (res.status === 429) throw new Error('Too many requests. Please try again in a little while.');
      if (!res.ok) throw new Error('Something went wrong. Please try again.');
      setStatus('done');
      setMessage('Thank you. We’ve received your request, and we’ll be in touch soon to set up a time.');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error && err.message ? err.message : 'Something went wrong. Please try again.');
    }
  }

  if (status === 'done') {
    return <FormStatus kind="success" message={message} />;
  }

  const field = (
    id: DemoField,
    label: string,
    input: (common: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string; className: string }) => ReactNode,
    help?: string,
  ) => {
    const err = errors[id];
    const describedBy = [help ? `demo-${id}-help` : '', err ? `demo-${id}-error` : ''].filter(Boolean).join(' ') || undefined;
    return (
      <div>
        <label htmlFor={`demo-${id}`} className={labelCls}>
          {label}
        </label>
        {help ? (
          <p id={`demo-${id}-help`} className={helpCls}>
            {help}
          </p>
        ) : null}
        {input({
          id: `demo-${id}`,
          'aria-invalid': err ? true : undefined,
          'aria-describedby': describedBy,
          className: `mt-2 ${inputOnPageCls}`,
        })}
        {err ? (
          <p id={`demo-${id}-error`} className={fieldErrorCls}>
            {err}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Request a demo" className="space-y-5">
      {field('facility_name', 'Community name', (c) => (
        <input {...c} type="text" autoComplete="organization" maxLength={200} value={values.facility_name} onChange={set('facility_name')} />
      ))}
      {field(
        'residents',
        'Number of residents',
        (c) => (
          <input {...c} type="text" inputMode="numeric" pattern="[0-9]*" value={values.residents} onChange={set('residents')} />
        ),
        `Roughly is fine (1 to ${DEMO_MAX_RESIDENTS.toLocaleString('en-US')}).`,
      )}
      {field('role', 'Your role', (c) => (
        <select {...c} value={values.role} onChange={set('role')}>
          <option value="">Choose your role</option>
          {DEMO_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      ))}
      {field('name', 'Your name', (c) => (
        <input {...c} type="text" autoComplete="name" maxLength={120} value={values.name} onChange={set('name')} />
      ))}
      {field('email', 'Work email', (c) => (
        <input {...c} type="email" autoComplete="email" maxLength={320} value={values.email} onChange={set('email')} />
      ))}
      {field(
        'phone',
        'Phone (optional)',
        (c) => <input {...c} type="tel" autoComplete="tel" value={values.phone} onChange={set('phone')} />,
        'A US number, if you’d like a call back.',
      )}
      <button type="submit" disabled={status === 'submitting'} className="btn-primary w-full disabled:opacity-60">
        {status === 'submitting' ? 'Sending…' : 'Request a demo'}
      </button>
      <FormStatus kind="error" id="demo-error" message={status === 'error' ? message : ''} />
      <p className="text-base text-muted">
        We use these details only to arrange your demo, and delete them after a year.
      </p>
    </form>
  );
}
