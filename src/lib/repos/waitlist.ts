import type { Querier } from '../querier';

export const waitlistRepo = {
  async signup(
    q: Querier,
    data: { email: string; sourcePage?: string | null; utm?: unknown; wantsDemo?: boolean },
  ): Promise<void> {
    await q.query(
      `INSERT INTO waitlist_signups (email, source_page, utm, wants_demo)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [
        data.email,
        data.sourcePage ?? null,
        data.utm ? JSON.stringify(data.utm) : null,
        !!data.wantsDemo,
      ],
    );
    await q.query(`INSERT INTO analytics_events (event_name, props) VALUES ($1, $2)`, [
      'waitlist_joined',
      JSON.stringify({ source_page: data.sourcePage ?? null, wants_demo: !!data.wantsDemo }),
    ]);
  },

  async requestDemo(
    q: Querier,
    data: { email: string; sourcePage?: string | null; utm?: unknown },
  ): Promise<void> {
    await q.query(
      `INSERT INTO waitlist_signups (email, source_page, utm, wants_demo)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (email) DO UPDATE SET wants_demo = true`,
      [data.email, data.sourcePage ?? null, data.utm ? JSON.stringify(data.utm) : null],
    );
    await q.query(`INSERT INTO analytics_events (event_name, props) VALUES ($1, $2)`, [
      'demo_requested',
      JSON.stringify({ source_page: data.sourcePage ?? null }),
    ]);
  },
};
