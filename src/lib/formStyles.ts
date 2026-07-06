/**
 * Shared form-field styling. The background differs by surface on purpose — an
 * input inside a bg-cloud card contrasts via bg-mist, while an input on the bare
 * bg-mist page contrasts via bg-cloud. Single-sourced here so the two variants
 * can't drift (they previously lived as same-named `inputCls` consts with
 * different values across pages).
 */
const base = 'w-full rounded-xl border border-line px-4 py-3 text-lg text-ink focus:border-sage';

/** Text input / select sitting inside a bg-cloud card. */
export const inputCls = `${base} bg-mist`;

/** Text input / select sitting directly on the bg-mist page. */
export const inputOnPageCls = `${base} bg-cloud`;
