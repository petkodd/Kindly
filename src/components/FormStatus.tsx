'use client';

/**
 * One place for a form's outcome message (chat 12). Errors are role="alert"
 * (announced at once, error colour, a "!" marker so colour isn't the only cue);
 * success and info messages sit in a polite live region that is always
 * rendered, even when empty, so screen readers pick up the first message.
 */
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
          <span aria-hidden="true">!</span>
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
          {kind === 'success' ? <span aria-hidden="true">✓</span> : null}
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}
