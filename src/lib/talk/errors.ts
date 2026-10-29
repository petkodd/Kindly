/**
 * Plain, speakable messages for everything that can go wrong on the parent's
 * talk screen. The parent never sees a raw server message ("Could not
 * transcribe audio.") or a dead end: every problem says what to do next, and
 * says whether typing or trying again will help.
 *
 * Kept free of React so it can be unit-tested and reused by a future spoken
 * error prompt.
 */

/** Who sent the talk link: a family member (gift), or the person themselves (self-use). */
export type LinkOwner = 'family' | 'self';

export interface TalkContext {
  /** First name of the family member who set Dearly up, when known and safe to show. */
  familyFirstName?: string | null;
  linkOwner?: LinkOwner;
}

export type TalkProblemKind =
  | 'not_heard'
  | 'link_expired'
  | 'not_available'
  | 'too_many'
  | 'voice_limit'
  | 'session_full'
  | 'too_long'
  | 'mic_blocked'
  | 'offline'
  | 'went_wrong';

export interface TalkProblem {
  kind: TalkProblemKind;
  message: string;
  /** Show "Type instead": typing can get round this problem. */
  canType: boolean;
  /** Show "Try again": the same action may work on a second go. */
  canRetry: boolean;
}

export interface TalkFailure {
  /** HTTP status, when the server answered. */
  status?: number;
  /** Our API error code (`error.code` in the JSON body), when present. */
  code?: string;
  /** The browser refused or lost microphone access. */
  micDenied?: boolean;
  /** The request never reached the server (offline, DNS, aborted). */
  network?: boolean;
}

/** "Sarah", or "your family" when no safe first name is known. */
export function familyLabel(ctx: TalkContext = {}): string {
  return ctx.familyFirstName?.trim() || 'your family';
}

/** What to do when the talk link no longer works. */
export function expiredLinkMessage(ctx: TalkContext = {}): string {
  if (ctx.linkOwner === 'self') return 'Please open Dearly again from your account.';
  return `Please ask ${familyLabel(ctx)} to send you a new link.`;
}

export function mapTalkError(failure: TalkFailure, ctx: TalkContext = {}): TalkProblem {
  if (failure.micDenied) {
    return {
      kind: 'mic_blocked',
      message: 'I can’t hear you because the microphone is turned off. You can type to me instead.',
      canType: true,
      canRetry: true,
    };
  }
  if (failure.network) {
    return {
      kind: 'offline',
      message: 'I’m having trouble connecting. Please check the internet and try again.',
      canType: true,
      canRetry: true,
    };
  }
  const { status, code } = failure;
  if (code === 'no_transcript' || status === 422) {
    return {
      kind: 'not_heard',
      message: 'Sorry, I didn’t catch that — please try again.',
      canType: true,
      canRetry: true,
    };
  }
  if (status === 401) {
    return { kind: 'link_expired', message: expiredLinkMessage(ctx), canType: false, canRetry: false };
  }
  if (status === 403 || status === 402) {
    const who = ctx.linkOwner === 'self' ? 'Please check your Dearly account.' : `Please ask ${familyLabel(ctx)} to check the account.`;
    return {
      kind: 'not_available',
      message: `I can’t chat just now. ${who}`,
      canType: false,
      canRetry: false,
    };
  }
  if (code === 'voice_limit') {
    return {
      kind: 'voice_limit',
      message: 'We’ve talked out loud a lot today. You can type to me instead, or we can talk again tomorrow.',
      canType: true,
      canRetry: false,
    };
  }
  if (code === 'conversation_full') {
    return {
      kind: 'session_full',
      message: 'We’ve had a long chat. Tap “I’m done for now”, then “Talk again” to start fresh.',
      canType: false,
      canRetry: false,
    };
  }
  if (status === 429) {
    return {
      kind: 'too_many',
      message: 'Let’s take a short break. Please try again in a few minutes.',
      canType: false,
      canRetry: true,
    };
  }
  if (status === 413) {
    return {
      kind: 'too_long',
      message: 'That was a bit long for me. Please try saying it in a shorter way.',
      canType: true,
      canRetry: true,
    };
  }
  return {
    kind: 'went_wrong',
    message: 'Sorry, something went wrong on my side. Please try again.',
    canType: true,
    canRetry: true,
  };
}
