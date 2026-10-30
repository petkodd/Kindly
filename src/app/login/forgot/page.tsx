import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/PasswordResetForms';

export const metadata: Metadata = { title: 'Reset your password — Dearly', robots: { index: false, follow: false } };

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen bg-mist px-4 py-20">
      <ForgotPasswordForm />
    </main>
  );
}
