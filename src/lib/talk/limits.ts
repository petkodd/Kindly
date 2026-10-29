import type { Querier } from '../querier';
import { rateLimitRepo } from '../repos/rateLimit';
import { conversationRepo } from '../repos/conversation';
import { runSessionEndJobs } from '../jobs/sessionEnd';
import { ConversationFullError, PayloadTooLargeError, RateLimitError } from '../types';

/**
 * Spend guards for the parent's talk routes. A leaked talk link must not be
 * able to run up unlimited AI and voice cost, so every turn is counted per
 * parent AND per IP, voice time is capped per parent per day, and each
 * message, recording and conversation has a size limit.
 *
 * Every limit is configurable by env (integer); the defaults are below. All
 * messages are short spoken-style sentences, because the parent may hear them.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function talkLimits() {
  return {
    parentPer10Min: envInt('TALK_LIMIT_PARENT_PER_10_MIN', 30),
    parentPerDay: envInt('TALK_LIMIT_PARENT_PER_DAY', 300),
    ipPer10Min: envInt('TALK_LIMIT_IP_PER_10_MIN', 30),
    ipPerDay: envInt('TALK_LIMIT_IP_PER_DAY', 300),
    voiceMinutesPerDay: envInt('TALK_VOICE_MINUTES_PER_DAY', 60),
  };
}

/** Typed messages are capped at this many characters. */
export const TEXT_MAX_CHARS = 2_000;
/** Voice uploads are capped at this many bytes (≈ several minutes of Opus, ~1 min of MP4). */
export const AUDIO_MAX_BYTES = 3 * 1024 * 1024;
/** A conversation is ended automatically once the parent has spoken this many times. */
export const MAX_PARENT_TURNS = 100;

const TEN_MIN = 10 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export const SLOW_DOWN_MESSAGE = 'Let’s take a short break. Please try again in a few minutes.';
export const DAILY_LIMIT_MESSAGE = 'We’ve talked a lot today. Let’s chat again tomorrow.';
export const VOICE_LIMIT_MESSAGE =
  'We’ve talked out loud a lot today. You can type to me instead, or we can talk again tomorrow.';

/**
 * Count one talk request (a turn or a new session) against the parent and the
 * caller's IP, short and daily windows. Throws RateLimitError (429) with a
 * speakable message once any limit is passed.
 */
export async function enforceTalkRate(q: Querier, parentId: string, ip: string): Promise<void> {
  const l = talkLimits();
  const checks: [string, number, number, string][] = [
    [`talk:parent:${parentId}:10m`, l.parentPer10Min, TEN_MIN, SLOW_DOWN_MESSAGE],
    [`talk:parent:${parentId}:day`, l.parentPerDay, DAY, DAILY_LIMIT_MESSAGE],
    [`talk:ip:${ip}:10m`, l.ipPer10Min, TEN_MIN, SLOW_DOWN_MESSAGE],
    [`talk:ip:${ip}:day`, l.ipPerDay, DAY, DAILY_LIMIT_MESSAGE],
  ];
  // Hit every window (so all counters advance together), then report the first breach.
  const results = await Promise.all(checks.map(([key, limit, windowMs]) => rateLimitRepo.hit(q, key, { limit, windowMs })));
  const breached = results.findIndex((r) => !r.allowed);
  if (breached >= 0) throw new RateLimitError(checks[breached][3]);
}

/** Voice seconds transcribed for this parent in the last 24 hours (from the cost ledger). */
export async function voiceSecondsLast24h(q: Querier, parentId: string): Promise<number> {
  const { rows } = await q.query<{ seconds: string | number | null }>(
    `SELECT COALESCE(SUM(quantity), 0) AS seconds FROM usage_costs
     WHERE parent_id = $1 AND provider = 'deepgram_stt' AND created_at > $2`,
    [parentId, new Date(Date.now() - DAY)],
  );
  return Number(rows[0]?.seconds ?? 0);
}

/** Refuse a voice turn once the parent's daily voice time is used up (typing still works). */
export async function enforceVoiceMinutes(q: Querier, parentId: string): Promise<void> {
  const capSeconds = talkLimits().voiceMinutesPerDay * 60;
  if ((await voiceSecondsLast24h(q, parentId)) >= capSeconds) {
    throw new RateLimitError(VOICE_LIMIT_MESSAGE, 'voice_limit');
  }
}

export function enforceTextCap(content: string): void {
  if (content.length > TEXT_MAX_CHARS) {
    throw new PayloadTooLargeError('That was a bit long for me. Please try saying it in a shorter way.');
  }
}

export function enforceAudioCap(bytes: number): void {
  if (bytes > AUDIO_MAX_BYTES) {
    throw new PayloadTooLargeError('That was a bit long for me. Please try saying it in a shorter way.');
  }
}

/**
 * End the conversation once the parent has had MAX_PARENT_TURNS turns, so one
 * open conversation can't grow (and be re-sent to the model) forever. The
 * client offers "Talk again", which starts a fresh one.
 */
export async function enforceTurnCap(q: Querier, conversationId: string, parentId: string): Promise<void> {
  const parentTurns = await conversationRepo.countParentTurns(q, conversationId);
  if (parentTurns >= MAX_PARENT_TURNS) {
    await conversationRepo.end(q, conversationId, parentId);
    // Summarize + extract like a normal end; best-effort (the end already happened).
    try {
      await runSessionEndJobs(q, conversationId);
    } catch (err) {
      console.error('session-end jobs failed after turn cap', conversationId, err);
    }
    throw new ConversationFullError();
  }
}
