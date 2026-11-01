'use client';

/**
 * One place for a form's outcome message (chat 12). Errors are role="alert"
 * (announced at once, error colour, a "!" marker so colour isn't the only cue);
 * success and info messages sit in a polite live region that is always
 * rendered, even when empty, so screen readers pick up the first message.
 */
/** Decorative shape cue (so colour isn't the only signal); no text content. */
function Icon({ kind }: { kind: 'error' | 'success' }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20" className="mt-1 h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.25">
      <circle cx="10" cy="10" r="8.5" />
      {kind === 'error' ? (
        <path d="M10 5.5v5.5M10 13.75v.5" strokeLinecap="round" />
      ) : (
        <path d="M6.25 10.25l2.5 2.5 5-5.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export type FormStatusKind = 'error' | 'success' | 'info';

export function FormStatus({
  kind,
  message,
  id,
  className = '',
}: {
  kind: FormStatusKind;
  message?: string | null;
  id?: string;
  className?: string;
}) {
  if (kind === 'error') {
    // role="alert" is announced when it is inserted with its text, so the
    // error region only exists while there is an error.
    if (!message) return null;
    return (
      <div id={id} role="alert" className={className}>
        <p className="flex items-start gap-2 rounded-xl border-2 border-error bg-cloud px-4 py-3 text-base font-semibold text-error">
          <Icon kind="error" />
          <span>{message}</span>
        </p>
      </div>
    );
  }
  return (
    <div id={id} role="status" aria-live="polite" className={className}>
      {message ? (
        <p
          className={
            kind === 'success'
              ? 'flex items-start gap-2 rounded-xl border-2 border-sageDeep bg-cloud px-4 py-3 text-base font-semibold text-sageDeep'
              : 'text-base text-muted'
          }
        >
          {kind === 'success' ? <Icon kind="success" /> : null}
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}
