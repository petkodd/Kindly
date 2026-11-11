/**
 * Shared form-field styling. The background differs by surface on purpose — an
 * input inside a bg-cloud card contrasts via bg-mist, while an input on the bare
 * bg-mist page contrasts via bg-cloud. Every text input, select and textarea in
 * the app goes through these (chat 12), so borders stay ≥3:1 (`field` token)
 * and the focus style can't drift. The visible focus ring comes from the global
 * :focus-visible outline in globals.css; the border darkens as a second cue.
 * Invalid fields (aria-invalid="true") get the error border.
 */
const base =
  'w-full rounded-xl border-2 border-field px-4 py-3 text-lg text-ink focus:border-sageDeep aria-[invalid=true]:border-error';

/** Text input / select sitting inside a bg-cloud card. */
export const inputCls = `${base} bg-mist`;

/** Text input / select sitting directly on the bg-mist page. */
export const inputOnPageCls = `${base} bg-cloud`;

/** Field label (block, above the input). */
export const labelCls = 'block text-lg font-semibold text-ink';

/** Help / caps text under a field (linked with aria-describedby). */
export const helpCls = 'mt-1 text-base text-muted';

/** Inline field error (linked with aria-describedby, the field gets aria-invalid). */
export const fieldErrorCls = 'mt-1 text-base font-semibold text-error';

/** Checkbox / radio sized for older hands (the label carries the tap target). */
export const checkCls = 'h-6 w-6 shrink-0 rounded border-2 border-field accent-sageDeep';
