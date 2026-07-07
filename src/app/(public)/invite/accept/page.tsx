import type { Metadata } from 'next';
import { InviteAccept } from '@/components/InviteAccept';

// Transactional link, not a marketing destination.
export const metadata: Metadata = { title: 'Accept invitation — Kindly', robots: { index: false, follow: false } };

export default function InviteAcceptPage() {
  return (
    <section className="container-k py-20">
      <InviteAccept />
    </section>
  );
}
