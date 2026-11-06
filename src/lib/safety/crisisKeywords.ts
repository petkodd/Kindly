/**
 * A small, deterministic crisis check that runs on the server BEFORE any talk
 * refusal (rate limit, size cap, voice-minute cap, full conversation).
 *
 * Release check NEW-2 (B3): a refused turn never reached the AI safety scan,
 * so "I want to kill myself" sent while rate-limited got "Let's take a short
 * break…" with no flag, no alert and no 988. This check is the backstop for
 * those paths only. It is NOT a replacement for the model scan
 * (SAFETY_SCAN_SYSTEM_V2), which still classifies every turn that is answered.
 *
 * Only P0 (self-harm) and P1 (acute medical) are covered, because those are the
 * tiers that must never wait. Phrases are chosen for precision: a match here
 * records a flag and alerts the family, so ordinary speech ("I fell asleep",
 * "a stroke of luck") must not match.
 */

export type CrisisKeywordSeverity = 'p0' | 'p1';

/** Normalise curly apostrophes so "don’t" matches like "don't". */
function normalise(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'");
}

const P0 =
  /\b(kill(ing)? myself|suicid(e|al)|end(ing)? (my|it) (life|all)|take my (own )?life|(don'?t|do not) want to (live|be alive|wake up)|want(ed)? to die|wish i (was|were) dead|better off (dead|without me)|hurt(ing)? myself|(take|took|taking|saving( up)?) (all )?(of )?my pills|overdose|(don'?t|do not) want to be a burden|ready to go be with|go be with (him|her|my (late )?(husband|wife|son|daughter|mother|father|mom|dad))|gave (all )?my [\w ]{0,30}away|giving (my )?(things|belongings|stuff) away)\b/i;

const P1 =
  /\b(chest (pain|hurts)|pain in my chest|chest (feels |is )?tight|can'?t breathe|cannot breathe|(trouble|hard|difficulty) breathing|heart attack|i fell\b(?! asleep)|fell down|had a fall|i'?ve fallen|(having|had|think it'?s|might be|it'?s) a stroke|(arm|leg|face|side) (is |feels |went |has gone )?(numb|weak)|slurr(ed|ing)|(face|mouth) (is )?droop\w*|fainted|passed out|(bleeding|blood) (a lot|won'?t stop|everywhere)|heavy bleeding)/i;

/**
 * The highest crisis severity the text clearly signals, or null. P0 wins over
 * P1 (the same order as the safety scan).
 */
export function detectCrisisKeywords(text: string | null | undefined): CrisisKeywordSeverity | null {
  if (!text) return null;
  const t = normalise(text);
  if (P0.test(t)) return 'p0';
  if (P1.test(t)) return 'p1';
  return null;
}
