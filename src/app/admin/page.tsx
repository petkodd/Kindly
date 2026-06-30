import type { Metadata } from 'next';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-mist">
      <div className="container-k py-12">
        <h1 className="font-display text-3xl font-semibold text-ink">Admin — Overview</h1>
        <p className="mt-4 text-lg text-muted">
          Signups, active users, cost per active user, cost per voice minute, retention, and the safety
          flag queue render here (US-12). Access-controlled + audit-logged on feature/admin-analytics.
        </p>
      </div>
    </div>
  );
}
