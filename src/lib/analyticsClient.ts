/**
 * Client-side event names accepted by POST /api/analytics/event. Deeper
 * product events (talk_session_started, memory_added, etc. — see
 * docs/analytics_events_v1.md) are emitted server-side, next to the action
 * they describe, not through this generic client endpoint.
 */
export type ClientEventName = 'page_viewed' | 'cta_clicked';

type Props = Record<string, string | number | boolean | null | undefined>;

/**
 * Fire-and-forget client analytics. No-ops on the server, and honors
 * Do-Not-Track / Global Privacy Control by simply not sending anything —
 * never a fallback that still records a coarse count.
 */
export function track(event: ClientEventName, props: Props = {}): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (navigator.doNotTrack === '1' || (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl) {
    return;
  }

  const payload = JSON.stringify({ event_name: event, props });
  const sent =
    typeof navigator.sendBeacon === 'function' &&
    navigator.sendBeacon('/api/analytics/event', new Blob([payload], { type: 'application/json' }));
  if (!sent) {
    fetch('/api/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
}
