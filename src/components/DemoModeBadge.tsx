import { isAiOrVoiceSimulated } from '@/lib/runtimeMode';

/** Visible label text — single-sourced so tests and docs match the UI. */
export const DEMO_BADGE_TEXT = 'Demo mode: simulated AI & voice';

/**
 * A visible, honest marker that the companion's replies and voice are
 * simulated (DEMO_MODE=true, or a local run without the AI/voice keys). Server
 * component: it reads env at render time and renders nothing when real
 * providers are in use.
 */
export function DemoModeBadge({ env }: { env?: Record<string, string | undefined> } = {}) {
  if (!isAiOrVoiceSimulated(env ?? process.env)) return null;
  return (
    <span
      role="status"
      data-testid="demo-mode-badge"
      className="inline-flex items-center rounded-full border-2 border-clay bg-cloud px-3 py-1 text-sm font-semibold text-ink"
    >
      {DEMO_BADGE_TEXT}
    </span>
  );
}
