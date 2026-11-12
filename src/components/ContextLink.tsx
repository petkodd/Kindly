import Link from 'next/link';
import type { ContextLinkContent } from '@/lib/content';

/**
 * SEO-10 (chat 21c): one sentence with a descriptive in-content link to
 * another public page. The anchor text says what the target page is about.
 */
export function ContextLink({ link, className = 'mt-5 text-lg text-muted' }: { link: ContextLinkContent; className?: string }) {
  return (
    <p className={className}>
      {link.before}
      <Link href={link.href} className="font-semibold text-sageDeep underline underline-offset-4">
        {link.label}
      </Link>
      {link.after}
    </p>
  );
}
