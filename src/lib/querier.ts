/**
 * Querier is the minimal surface our repositories need. Both the real `pg`
 * Pool and the in-memory test database satisfy it, so repository logic is
 * tested without a live Postgres and runs unchanged in production.
 */
export interface Querier {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}
