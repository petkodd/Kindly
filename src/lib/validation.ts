/**
 * Shared, framework-agnostic validation primitives. Importable from both the
 * server repos and the client pages so the same rule isn't re-declared (and
 * allowed to drift) in multiple places.
 */

/** Pragmatic email shape check — a non-empty local part, an @, and a dotted domain. */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
