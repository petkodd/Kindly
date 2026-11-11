import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/seo';
import { TERMS_OF_USE } from '@/lib/legal';
import { LegalDocumentView } from '@/components/LegalDocumentView';

export const metadata: Metadata = buildMetadata({
  title: 'Terms of Use (Draft) | Dearly',
  description:
    'The agreement for using Dearly, an AI companion for older adults: what it is and is not, emergencies, accounts, billing, acceptable use and your content.',
  path: '/terms',
});

export default function TermsPage() {
  return <LegalDocumentView doc={TERMS_OF_USE} otherLink={{ href: '/privacy', label: 'Privacy Policy' }} />;
}
