import type { ElementType, ReactNode } from 'react';

/** The standard app surface: a bordered bg-cloud card (chat 12). */
export function Card({
  as: Tag = 'section',
  className = '',
  children,
  ...rest
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  return (
    <Tag className={`rounded-2xl border border-line bg-cloud p-6 ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}
