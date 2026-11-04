import type { Querier } from '../querier';
import type { DemoRequest } from '../demoRequest';

export type SalesAlertStatus = 'sent' | 'simulated' | 'not_configured' | 'failed';

/** Facility demo requests (migration 0021, chat 13). */
export const demoRequestRepo = {
  async create(q: Querier, req: DemoRequest & { sourcePage?: string | null }): Promise<{ id: string }> {
    const { rows } = await q.query<{ id: string }>(
      `INSERT INTO facility_demo_requests
         (facility_name, residents, contact_role, contact_name, email, phone, source_page)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [req.facilityName, req.residents, req.role, req.name, req.email, req.phone, req.sourcePage ?? null],
    );
    // Analytics: no PII, just that it happened and how big the community is.
    await q.query(`INSERT INTO analytics_events (event_name, props) VALUES ($1, $2)`, [
      'demo_requested',
      JSON.stringify({ source_page: req.sourcePage ?? null, residents: req.residents, role: req.role }),
    ]);
    return rows[0];
  },

  async setSalesAlert(q: Querier, id: string, status: SalesAlertStatus): Promise<void> {
    await q.query(`UPDATE facility_demo_requests SET sales_alert = $2 WHERE id = $1`, [id, status]);
  },
};
