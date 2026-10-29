import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/PasswordResetForms';

// Transactional link, not a marketing destination.
export const metadata: Metadata = { title: 'Choose a new password — Dearly', robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen bg-mist px-4 py-20">
      <ResetPasswordForm />
    </main>
  );
}
