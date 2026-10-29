/**
 * Runtime mode: demo vs. real providers.
 *
 * The AI, speech and email clients each have a deterministic fake. Before this
 * module, every client fell back to its fake whenever a key was missing —
 * including on the production deploy, where a missing key would silently turn
 * the companion into canned replies and mark summaries as delivered when no
 * email went out. The rules are now:
 *
 *  - DEMO_MODE=true      → the fakes are used on purpose (even if keys are set),
 *                          so a demo never spends money or emails a real person,
 *                          and the app shows a visible "Demo mode" badge.
 *  - VERCEL_ENV=production and DEMO_MODE is not "true"
 *                        → a missing provider key throws a clear error when the
 *                          client is built. Never a silent fake in production.
 *  - anything else (local dev, tests, previews)
 *                        → a missing key falls back to the fake, as before.
 */

type Env = Record<string, string | undefined>;

/** True only when DEMO_MODE is exactly "true". */
export function isDemoMode(env: Env = process.env): boolean {
  return env.DEMO_MODE === 'true';
}

/** True on the Vercel production deployment (not preview, not local). */
export function isProductionDeploy(env: Env = process.env): boolean {
  return env.VERCEL_ENV === 'production';
}

/** Thrown when production is missing a paid provider key and DEMO_MODE is off. */
export class MissingProviderKeyError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
        'Production (VERCEL_ENV=production) never falls back to the simulated client. ' +
        'Set the key, or set DEMO_MODE=true for a demo-only deployment.',
    );
    this.name = 'MissingProviderKeyError';
  }
}

/**
 * Decide whether a client should use its fake. `required` lists the env var
 * names the real client needs. Returns true to use the fake; throws
 * MissingProviderKeyError when production is missing any of them.
 */
export function shouldUseFake(required: string[], env: Env = process.env): boolean {
  if (isDemoMode(env)) return true;
  const missing = required.filter((name) => !env[name]);
  if (missing.length === 0) return false;
  if (isProductionDeploy(env)) throw new MissingProviderKeyError(missing);
  return true;
}

/** Env var names each real client needs. Single source for the guard and the badge. */
export const AI_KEYS = ['AI_API_KEY'];
export const SPEECH_KEYS = ['DEEPGRAM_API_KEY', 'ELEVENLABS_API_KEY'];
export const EMAIL_KEYS = ['EMAIL_API_KEY', 'EMAIL_FROM'];

/**
 * True when the companion's AI or voice is simulated — drives the visible
 * "Demo mode: simulated AI & voice" badge. Never throws (the badge must not
 * break a page); the clients themselves enforce the production guard.
 */
export function isAiOrVoiceSimulated(env: Env = process.env): boolean {
  if (isDemoMode(env)) return true;
  if (isProductionDeploy(env)) return false;
  return [...AI_KEYS, ...SPEECH_KEYS].some((name) => !env[name]);
}
