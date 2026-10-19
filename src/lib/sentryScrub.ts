/**
 * Scrubs Sentry events (errors AND transactions) before they leave the app.
 * Wired into every Sentry.init as beforeSend + beforeSendTransaction
 * (sentry.server.config.ts, sentry.edge.config.ts, instrumentation-client.ts).
 *
 * What it removes, anywhere in the event (request, spans, breadcrumbs,
 * extra, contexts, exception messages):
 *  1. URL query strings and fragments. Bearer tokens travel in URLs
 *     (/app/talk?token=, /login/verify?token=) and would otherwise land in
 *     request.url, span descriptions, navigation/fetch breadcrumbs and Referer.
 *  2. The `detail` field of pg errors, which echoes row values
 *     ("Key (email)=(ann@example.com) already exists."), plus the same text
 *     if it was already stringified into a message.
 *  3. Upstream provider response bodies (Deepgram/ElevenLabs/Anthropic...):
 *     `body`-style keys are dropped and "X failed: 502 <body>" messages are
 *     cut back to the status code.
 *  4. Email addresses in any remaining string.
 *
 * Pure and dependency-free so it runs in node, edge and the browser.
 */

const FILTERED = '[Filtered]';

/** Keys removed outright wherever they appear. */
const DROP_KEYS = new Set([
  'detail', // pg DatabaseError.detail
  'body',
  'responseBody',
  'response_body',
  'rawBody',
  'cookies',
  'query_string',
  'http.query',
  'url.query',
]);

/** Keys whose value is a URL: keep origin + path, drop query and fragment. */
const URL_KEYS = new Set([
  'url',
  'http.url',
  'url.full',
  'http.target',
  'from',
  'to',
  'referer',
  'Referer',
  'referrer',
]);

// A URL or absolute path followed by a query string: keep the part before '?'.
// Requires a path-ish prefix so ordinary prose ("How are you? Fine.") is left alone.
const PATH_WITH_QUERY = /((?:[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>]+)|(?:\/[^\s?#"'<>]*))\?[^\s#"'<>]*(#[^\s"'<>]*)?/gi;
// Belt and braces for secrets that appear as bare params ("token=abc" in prose).
const SECRET_PARAM = /\b(token|access_token|refresh_token|code|key|signature|sig|secret|password)=[^\s&#"'<>]+/gi;
// pg detail text: Key (email)=(ann@example.com) already exists.
const PG_KEY_DETAIL = /Key \([^)]*\)=\([^)]*\)/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// "Deepgram STT failed: 502 {...body...}" -> "Deepgram STT failed: 502"
// "... failed (502): <body>" is normalised the same way.
const FAILED_WITH_BODY = /^([\s\S]*?\bfailed)(?:: | \()(\d{3})(?!\d)\)?[\s\S]+$/;
// Anthropic/OpenAI style APIError message: '400 {"type":"error",...}'
const STATUS_WITH_JSON = /^(\d{3}) [{[][\s\S]*$/;

export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

export function scrubString(s: string): string {
  return s
    .replace(PATH_WITH_QUERY, '$1')
    .replace(SECRET_PARAM, `$1=${FILTERED}`)
    .replace(PG_KEY_DETAIL, `Key (${FILTERED})`)
    .replace(EMAIL, FILTERED);
}

/** Exception messages: also cut provider response bodies back to the status. */
export function scrubErrorMessage(s: string): string {
  return scrubString(s.replace(FAILED_WITH_BODY, '$1: $2').replace(STATUS_WITH_JSON, '$1'));
}

function walk(value: unknown, key: string | undefined, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    if (key && URL_KEYS.has(key)) return scrubString(stripQuery(value));
    return scrubString(value);
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = walk(value[i], undefined, seen);
    return value;
  }
  const obj = value as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    if (DROP_KEYS.has(k)) {
      delete obj[k];
      continue;
    }
    obj[k] = walk(obj[k], k, seen);
  }
  return obj;
}

type ScrubbableEvent = {
  request?: { data?: unknown; cookies?: unknown } & Record<string, unknown>;
  exception?: { values?: { value?: string }[] };
} & Record<string, unknown>;

/** Mutates and returns the event. Never throws: a scrubber bug drops the event instead. */
export function scrubEvent<T>(event: T): T | null {
  try {
    const e = event as unknown as ScrubbableEvent;
    if (e.request) {
      delete e.request.data; // request bodies: conversations, memories, summaries
      delete e.request.cookies;
    }
    for (const ex of e.exception?.values ?? []) {
      if (typeof ex.value === 'string') ex.value = scrubErrorMessage(ex.value);
    }
    walk(e, undefined, new WeakSet());
    return event;
  } catch {
    return null; // fail closed: better no report than a leaky one
  }
}

/** Plug-in for Sentry.init({ beforeSend, beforeSendTransaction }). */
export const sentryScrubOptions = {
  beforeSend: <T>(event: T): T | null => scrubEvent(event),
  beforeSendTransaction: <T>(event: T): T | null => scrubEvent(event),
};

/**
 * Safe one-line description of an error for console logs: name, pg code and
 * constraint, scrubbed message. Never includes pg `detail` or response bodies.
 */
export function describeError(err: unknown): Record<string, string> {
  if (!(err instanceof Error)) return { name: typeof err, message: '[non-Error thrown]' };
  const e = err as Error & { code?: unknown; constraint?: unknown; table?: unknown };
  const out: Record<string, string> = { name: e.name, message: scrubErrorMessage(e.message) };
  if (typeof e.code === 'string') out.code = e.code;
  if (typeof e.constraint === 'string') out.constraint = e.constraint;
  if (typeof e.table === 'string') out.table = e.table;
  return out;
}
