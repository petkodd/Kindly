import type { Metadata } from 'next';
import { AdminDashboard } from './AdminDashboard';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-mist">
      <div className="container-k py-12">
        <h1 className="font-display text-3xl font-semibold text-ink">Admin — Overview</h1>
        <AdminDashboard />
      </div>
    </div>
  );
}
