import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AppNav } from '../src/components/AppNav';

let pathname = '/app/talk';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
});

describe('AppNav', () => {
  it('links to all six private pages', () => {
    render(<AppNav />);
    const expected = [
      ['Talk', '/app/talk'],
      ['Family Summary', '/app/family-summary'],
      ['Memories', '/app/memories'],
      ['Referrals', '/app/referrals'],
      ['Parent Profile', '/app/parent-profile'],
      ['Account', '/app/account'],
    ];
    for (const [label, href] of expected) {
      expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(href);
    }
  });

  it('marks the current page as active via aria-current', () => {
    pathname = '/app/memories';
    render(<AppNav />);
    expect(screen.getByRole('link', { name: 'Memories' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Talk' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Account' }).getAttribute('aria-current')).toBeNull();
  });

  it('marks Account active when on the account page', () => {
    pathname = '/app/account';
    render(<AppNav />);
    expect(screen.getByRole('link', { name: 'Account' }).getAttribute('aria-current')).toBe('page');
  });

  it('renders nothing on /app/onboarding, so a buyer cannot navigate away from the wizard', () => {
    pathname = '/app/onboarding';
    const { container } = render(<AppNav />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
