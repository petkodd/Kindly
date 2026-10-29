import type { Querier } from '../querier';
import type { Parent } from '../types';
import { alertContactFirstName, resolveAlertContact } from '../safety/alerts';
import type { LinkOwner } from './errors';

/** Talk-screen settings from the parent profile, sent to the client with the session. */
export interface TalkSettings {
  large_text: boolean;
  voice_first: boolean;
  speech_rate: 'slow' | 'normal';
  language: string;
}

export interface TalkContextPayload {
  /**
   * First name of the family member who set Dearly up, so error copy can say
   * "Please ask Sarah to send you a new link." Only ever sent to someone
   * already holding a valid talk link, and sanitized to letters, apostrophes
   * and hyphens (same rule as the safety-alert wording). Null for self-use or
   * when no usable name is on file.
   */
  family_first_name: string | null;
  link_owner: LinkOwner;
}

export async function talkContextFor(q: Querier, parent: Parent): Promise<TalkContextPayload> {
  if (parent.relationship === 'self') return { family_first_name: null, link_owner: 'self' };
  const contact = await resolveAlertContact(q, parent);
  return { family_first_name: alertContactFirstName(contact?.fullName), link_owner: 'family' };
}

export function talkSettingsFor(parent: Parent): TalkSettings {
  return {
    large_text: parent.large_text,
    voice_first: parent.voice_first,
    speech_rate: parent.speech_rate,
    language: parent.language,
  };
}
