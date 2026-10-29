import type { ConversationTurn } from './types';

/**
 * The companion's rolling context window. Each turn sends only the most recent
 * turns, and only as many as fit a token budget, so a long conversation does
 * not resend its whole transcript (and grow its cost) on every reply.
 *
 * Tokens are estimated at ~4 characters each, the usual rule of thumb for
 * English; it errs slightly high for short words, which keeps us under budget.
 * Within one session there is no rolling summary yet: turns older than the
 * window are simply not sent (the turn cap in src/lib/talk/limits.ts bounds a
 * conversation at 100 parent turns). A rolling summary is a follow-up.
 */
export const HISTORY_MAX_TURNS = 20;
export const HISTORY_TOKEN_BUDGET = 1_800;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Keep the newest turns that fit both the turn count and the token budget, oldest first. */
export function trimHistory(
  turns: ConversationTurn[],
  opts: { maxTurns?: number; tokenBudget?: number } = {},
): ConversationTurn[] {
  const maxTurns = opts.maxTurns ?? HISTORY_MAX_TURNS;
  const budget = opts.tokenBudget ?? HISTORY_TOKEN_BUDGET;
  const kept: ConversationTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0 && kept.length < maxTurns; i -= 1) {
    const cost = estimateTokens(turns[i].content) + 4; // + role/formatting overhead
    if (used + cost > budget) break;
    kept.push(turns[i]);
    used += cost;
  }
  return kept.reverse();
}
