import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthForm } from '@/components/AuthForm';

export const metadata: Metadata = { title: 'Create account — Dearly', robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ next?: string | string[]; ref?: string | string[] }> };

export default async function SignupPage({ searchParams }: Props) {
  const { next, ref } = await searchParams;
  return (
    <main className="min-h-screen bg-mist px-4 py-20">
      <AuthForm
        mode="signup"
        next={typeof next === 'string' ? next : null}
        referralCode={typeof ref === 'string' ? ref : null}
      />
      <p className="mx-auto mt-6 max-w-md text-center text-base text-muted">
        By creating an account you agree to our{' '}
        <Link href="/terms" className="text-sageDeep underline">
          Terms of Use
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="text-sageDeep underline">
          Privacy Policy
        </Link>
        .
      </p>
    </main>
  );
}
