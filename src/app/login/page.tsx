import type { Metadata } from 'next';
import { AuthForm } from '@/components/AuthForm';

export const metadata: Metadata = { title: 'Sign in — Dearly', robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ next?: string | string[] }> };

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;
  return (
    <main className="min-h-screen bg-mist px-4 py-20">
      <AuthForm mode="login" next={typeof next === 'string' ? next : null} />
    </main>
  );
}
