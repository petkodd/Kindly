import type { Metadata } from 'next';
import { AdminDashboard } from './AdminDashboard';
import { DemoModeBadge } from '@/components/DemoModeBadge';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-mist">
      <div className="container-k py-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-display text-3xl font-semibold text-ink">Admin — Overview</h1>
          <DemoModeBadge />
        </div>
        <AdminDashboard />
      </div>
    </div>
  );
}
