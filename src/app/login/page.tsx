import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';

export const metadata: Metadata = { title: 'Sign in — Kindly', robots: { index: false, follow: false } };

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-mist px-4 py-20">
      <AuthForm mode="login" />
    </main>
  );
}
