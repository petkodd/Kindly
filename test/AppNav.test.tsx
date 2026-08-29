import { describe, it, expect, vi, afterEach } from 'vitest';
import { forwardRef } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { AppNav } from '../src/components/AppNav';

let pathname = '/app/talk';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock(
  'next/link',
  () => ({
    // forwardRef so AppNav's ref-to-the-active-link (used to scroll it into
    // view) actually attaches in tests, matching real next/link behavior.
    default: forwardRef<HTMLAnchorElement, { href: string; children: React.ReactNode }>(
      ({ href, children, ...rest }, ref) => (
        <a href={href} ref={ref} {...rest}>{children}</a>
      ),
    ),
  }),
);

// jsdom doesn't implement scrollIntoView at all — stub it as a no-op by
// default so every test can render AppNav (its effect calls this
// unconditionally); the dedicated test below overrides it with a spy.
HTMLElement.prototype.scrollIntoView = vi.fn();

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

  it('scrolls the active link into view — on mobile the link row scrolls horizontally and starts at its leftmost position, so landing directly on a page further along (e.g. Parent Profile) used to render with its label clipped mid-word', () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    pathname = '/app/parent-profile';
    render(<AppNav />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    // Called on the active link itself, not some other element.
    const target = scrollIntoView.mock.contexts[0] as HTMLElement;
    expect(target.textContent).toBe('Parent Profile');
  });
});
