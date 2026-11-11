/**
 * The exact words the parent sees (and hears) before a consent is recorded.
 * Pure module with no server imports: the talk screen renders these same
 * constants, and the server stores the text + version in consents.detail, so
 * what is on record is always what was shown.
 *
 * Bump the version whenever the wording changes. Old versions stay valid for
 * consents already given; they are kept in git history.
 */

/** Shown on the talk intro screen; recorded as the parent_conversation consent. */
const CONVERSATION_DISCLOSURE = 'Dearly is an AI companion — not a real person.';
const CONVERSATION_INVITE = 'I’m Dearly. I’d love to chat with you whenever you like.';

export const PARENT_CONVERSATION_NOTICE = {
  version: 'parent_conversation.v1',
  /** The boxed AI disclosure at the top of the intro screen. */
  disclosure: CONVERSATION_DISCLOSURE,
  /** The line under the "Hello" heading. */
  invite: CONVERSATION_INVITE,
  /** Everything above, as stored with the consent (the parent then taps "Start talking"). */
  text: `${CONVERSATION_DISCLOSURE} ${CONVERSATION_INVITE}`,
} as const;

export const PARENT_SUMMARY_SHARING_NOTICE_VERSION = 'parent_summary_sharing.v1';

/** A "Not now" answer is asked again after this many days. */
export const SUMMARY_SHARING_REASK_DAYS = 7;

export interface SummarySharingNoticeInput {
  /**
   * Who reads the weekly note, already phrased for the sentence, e.g. "Sarah",
   * "Sarah and 2 other family members", "your family".
   */
  recipients: string;
  /** True when `recipients` is one person, so the verb is "gets". */
  singular: boolean;
  /**
   * First name of the person told about a crisis (decision D2), or null when
   * nobody in the family is alerted (self-use). The safety sentence is not
   * optional: whenever someone would be alerted, the parent is told.
   */
  alertContactFirstName: string | null;
}

/** The talk-screen notice the parent answers with Yes / Not now (chat 9, D2). */
export function summarySharingNoticeV1(input: SummarySharingNoticeInput): string {
  const verb = input.singular ? 'gets' : 'get';
  const weekly =
    `Each week, ${input.recipients} ${verb} a short note about what we chatted about in general — ` +
    'never our conversations word for word.';
  const safety = input.alertContactFirstName
    ? ` And if you ever seem to be in danger, I’ll let ${input.alertContactFirstName} know so they can check on you.`
    : '';
  return `${weekly}${safety} Is that OK?`;
}

/** What the talk screen receives for the notice. */
export interface SummarySharingNoticePayload {
  version: string;
  text: string;
  /** The notice read aloud, or null when speech is unavailable (the text is always shown). */
  audio_url: string | null;
}
