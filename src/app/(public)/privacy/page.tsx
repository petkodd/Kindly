import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { PRIVACY_POLICY } from '@/lib/legal';
import { LegalDocumentView } from '@/components/LegalDocumentView';

export const metadata: Metadata = buildMetadata({
  title: 'Privacy Policy (Draft) | Dearly',
  description:
    'What Dearly collects, the vendors that help run it, how long data is kept (30-day transcripts) and how to export or delete your family’s data.',
  path: '/privacy',
});

export default function PrivacyPage() {
  return <LegalDocumentView doc={PRIVACY_POLICY} otherLink={{ href: '/terms', label: 'Terms of Use' }} />;
}
