import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
// The header's auth probe is irrelevant to stacking.
vi.mock('../src/components/AuthStatus', () => ({ AuthStatus: () => null }));

import { SiteHeader } from '../src/components/SiteHeader';

afterEach(cleanup);

/**
 * Release check NEW-4 (B5). `backdrop-blur` makes the header its own stacking
 * context, so the mobile menu panel's z-50 only counts inside the header. The
 * header itself must sit above the page's later positioned sections (the home
 * hero is `relative`), or the open menu is painted over and can't be tapped.
 * jsdom can't paint, so this pins the classes that make it work; the real
 * check is the Playwright screenshots in docs/autopilot/evidence/chat-15/.
 */
describe('SiteHeader stacking (mobile menu above the page)', () => {
  it('the header is positioned with z-40, so its menu panel paints above the hero', () => {
    const { container } = render(<SiteHeader />);
    const header = container.querySelector('header')!;
    const classes = header.className.split(/\s+/);
    expect(classes).toContain('relative');
    expect(classes).toContain('z-40');
    expect(classes).toContain('backdrop-blur');
  });

  it('the open menu panel is inside the header and its links are rendered', () => {
    const { container } = render(<SiteHeader />);
    fireEvent.click(screen.getByRole('button', { name: /menu/i }));
    const header = container.querySelector('header')!;
    const panelNav = within(header).getAllByRole('navigation', { name: 'Main' }).at(-1)!;
    expect(within(panelNav).getByRole('link', { name: 'Pricing' }).getAttribute('href')).toBe('/pricing');
    expect(panelNav.closest('[class*="z-50"]')).not.toBeNull();
  });
});
