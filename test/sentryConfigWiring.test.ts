import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the options every Sentry config passes to Sentry.init.
const init = vi.fn();
vi.mock('@sentry/nextjs', () => ({ init, captureRouterTransitionStart: vi.fn() }));

const TOKEN = 'tok_wiring_check';

describe.each([
  ['sentry.server.config.ts', () => import('../sentry.server.config')],
  ['sentry.edge.config.ts', () => import('../sentry.edge.config')],
  ['instrumentation-client.ts', () => import('../instrumentation-client')],
])('%s', (_name, load) => {
  beforeEach(() => {
    init.mockClear();
    vi.resetModules();
  });

  it('installs the scrubber as beforeSend and beforeSendTransaction', async () => {
    await load();
    expect(init).toHaveBeenCalledTimes(1);
    const opts = init.mock.calls[0][0];
    expect(opts.sendDefaultPii).toBe(false);

    const err = opts.beforeSend({ request: { url: `/login/verify?token=${TOKEN}` } }, {});
    expect(JSON.stringify(err)).not.toContain(TOKEN);

    const tx = opts.beforeSendTransaction({ transaction: `GET /app/talk?token=${TOKEN}`, spans: [] }, {});
    expect(JSON.stringify(tx)).not.toContain(TOKEN);
  });
});
