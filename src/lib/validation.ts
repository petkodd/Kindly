/**
 * Loose email-shape check shared by the client (invite form) and the server
 * (consent repo). It requires a non-empty local part, an '@', a domain, a dot,
 * and a TLD, with no whitespace anywhere. Real deliverability is proven by the
 * invite email actually arriving — this only catches obvious typos early.
 */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
