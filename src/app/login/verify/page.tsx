import type { Metadata } from 'next';
import { MagicLinkVerify } from '@/components/MagicLinkVerify';

// Transactional link, not a marketing destination.
export const metadata: Metadata = { title: 'Signing in — Kindly', robots: { index: false, follow: false } };

export default function MagicLinkVerifyPage() {
  return (
    <main className="min-h-screen bg-mist px-4 py-20">
      <div className="mx-auto max-w-sm">
        <MagicLinkVerify />
      </div>
    </main>
  );
}
