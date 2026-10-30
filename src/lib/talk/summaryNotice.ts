import type { Querier } from '../querier';
import type { Parent } from '../types';
import { consentRepo } from '../repos/consent';
import { alertContactFirstName, resolveAlertContact } from '../safety/alerts';
import {
  PARENT_SUMMARY_SHARING_NOTICE_VERSION,
  SUMMARY_SHARING_REASK_DAYS,
  summarySharingNoticeV1,
} from './notices';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build the summary-sharing notice for this parent, as it reads today.
 *
 * Who gets the note: the family member who set Dearly up (they read every
 * summary in their dashboard) plus anyone they invited, pending or accepted.
 * Recipients are stored as email addresses only, so other recipients are
 * counted, not named — an address is never read out to the parent.
 *
 * Who is alerted in a crisis (D2): the same buyer, unless Dearly is set up for
 * self-use, where no family alert goes out and the sentence is left out.
 */
export async function buildSummarySharingNotice(
  q: Querier,
  parent: Parent,
): Promise<{ version: string; text: string }> {
  const version = PARENT_SUMMARY_SHARING_NOTICE_VERSION;
  if (parent.relationship === 'self') {
    return {
      version,
      text: summarySharingNoticeV1({
        recipients: 'the family members you invite',
        singular: false,
        alertContactFirstName: null,
      }),
    };
  }

  const contact = await resolveAlertContact(q, parent);
  const buyerName = contact ? alertContactFirstName(contact.fullName) : null;
  const buyerEmail = contact?.email.trim().toLowerCase() ?? null;
  const invited = await consentRepo.listRecipients(q, parent.id);
  const others = invited.filter((r) => r.email.trim().toLowerCase() !== buyerEmail).length;

  let recipients: string;
  let singular: boolean;
  if (!buyerName) {
    recipients = 'your family';
    singular = true;
  } else if (others === 0) {
    recipients = buyerName;
    singular = true;
  } else {
    recipients = `${buyerName} and ${others} other family ${others === 1 ? 'member' : 'members'}`;
    singular = false;
  }

  return {
    version,
    text: summarySharingNoticeV1({
      recipients,
      singular,
      // A buyer with no usable first name is still alerted: say "your family".
      alertContactFirstName: contact ? buyerName ?? 'your family' : null,
    }),
  };
}

/**
 * True when the talk screen should show the summary-sharing notice: the
 * parent has not said yes, and has not said "Not now" in the last
 * SUMMARY_SHARING_REASK_DAYS days.
 */
export async function summarySharingNoticeDue(q: Querier, parentId: string, now: Date = new Date()): Promise<boolean> {
  if (await consentRepo.has(q, parentId, 'parent_summary_sharing')) return false;
  const last = await consentRepo.latest(q, parentId, 'parent_summary_sharing');
  if (!last) return true;
  const answer = (last.detail as { answer?: string } | null)?.answer;
  if (answer !== 'not_now') return true; // a yes that was later revoked: ask again
  return now.getTime() - new Date(last.granted_at).getTime() >= SUMMARY_SHARING_REASK_DAYS * DAY_MS;
}
