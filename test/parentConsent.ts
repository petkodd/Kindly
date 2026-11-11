import type { Querier } from '../src/lib/querier';
import { consentRepo } from '../src/lib/repos/consent';

/**
 * Record the parent's "Yes" to the talk-screen summary-sharing notice (chat 9).
 * Summary sending, manual or automatic, requires it.
 */
export async function parentSaidYesToSummaries(q: Querier, parentId: string): Promise<void> {
  await consentRepo.recordSummarySharingAnswer(q, {
    parentId,
    answer: 'yes',
    noticeText: 'Each week, Sarah gets a short note about what we chatted about in general — never our conversations word for word. Is that OK?',
    noticeVersion: 'parent_summary_sharing.v1',
  });
}
