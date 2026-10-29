import type { AiClient } from './types';
import { fakeAiClient } from './fake';
import { AI_KEYS, shouldUseFake } from '../runtimeMode';

export * from './types';
export { fakeAiClient } from './fake';
// Note: `createAnthropicAiClient` is intentionally NOT re-exported here — it is
// loaded lazily below so importing this module never pulls in the SDK on the
// keyless path. Import it from './anthropic' directly if you need it explicitly.

let cached: AiClient | undefined;

/**
 * Resolve the companion model client. Uses the deterministic fake when
 * DEMO_MODE=true, or when AI_API_KEY is unset outside production (local dev,
 * tests). On the production deploy a missing key throws
 * MissingProviderKeyError instead — see src/lib/runtimeMode.ts. The real
 * client is imported lazily so the SDK never loads in the keyless path.
 */
export function getAiClient(): AiClient {
  if (cached) return cached;
  if (shouldUseFake(AI_KEYS)) {
    cached = fakeAiClient;
    return cached;
  }
  const apiKey = process.env.AI_API_KEY as string;
  // Lazy require keeps the SDK out of the keyless (test/dev) path.
  const { createAnthropicAiClient } = require('./anthropic') as typeof import('./anthropic');
  cached = createAnthropicAiClient(apiKey);
  return cached;
}

/** Test seam: reset the memoized client (e.g. after changing env in a test). */
export function resetAiClient(): void {
  cached = undefined;
}
