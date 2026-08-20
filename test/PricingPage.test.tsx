import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PricingPage from '../src/app/(public)/pricing/page';

afterEach(() => {
  cleanup();
});

describe('PricingPage', () => {
  it('defaults to Annual pricing on first render (SSR-equivalent default — no interaction needed)', () => {
    render(<PricingPage />);
    expect(screen.getByText('$566.40')).toBeTruthy();
    expect(screen.getByText(/\/year/)).toBeTruthy();
    expect(screen.getByText(/Save 20%/)).toBeTruthy();
    expect(screen.getByText(/\$47\.20\/mo equivalent/)).toBeTruthy();
  });

  it('switching to Monthly updates the displayed price without navigation', () => {
    render(<PricingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(screen.getByText('$59.00')).toBeTruthy();
    expect(screen.queryByText('$566.40')).toBeNull();
    expect(screen.queryByText(/Save 20%/)).toBeNull();
  });

  it('switching back to Annual restores the annual price and savings badge', () => {
    render(<PricingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annual' }));
    expect(screen.getByText('$566.40')).toBeTruthy();
    expect(screen.getByText(/Save 20%/)).toBeTruthy();
  });

  it('the Family CTA link carries the selected interval into checkout', () => {
    render(<PricingPage />);
    const cta = screen.getByRole('link', { name: 'Choose Family' }) as HTMLAnchorElement;
    expect(cta.getAttribute('href')).toBe('/app/onboarding?interval=year');

    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(screen.getByRole('link', { name: 'Choose Family' }).getAttribute('href')).toBe(
      '/app/onboarding?interval=month',
    );
  });

  it('includes both intervals in the JSON-LD structured data', () => {
    render(<PricingPage />);
    const script = document.querySelector('script[type="application/ld+json"]');
    expect(script).toBeTruthy();
    const data = JSON.parse(script!.innerHTML);
    const offerNames = data.offers.map((o: { name: string }) => o.name);
    expect(offerNames).toContain('Family');
    expect(offerNames).toContain('Family (Annual)');
  });

  it('renders the highlighted Founding Family card with its badge, price, and CTA', () => {
    render(<PricingPage />);
    expect(screen.getByText('Founding Family')).toBeTruthy();
    expect(screen.getByText('Best for new families')).toBeTruthy();
    expect(screen.getByText('$29')).toBeTruthy();
    // "Set up the gift" also appears as the page's hero CTA, so there are
    // multiple matches — every one of them must point at onboarding.
    const ctas = screen.getAllByRole('link', { name: 'Set up the gift' }) as HTMLAnchorElement[];
    expect(ctas.length).toBeGreaterThan(0);
    for (const cta of ctas) expect(cta.getAttribute('href')).toBe('/app/onboarding');
  });

  it('never shows a Monthly/Annual toggle on the Founding Family card — only the Family plan has an annual price', () => {
    render(<PricingPage />);
    // Exactly one toggle on the page (the shared, view-level one), not one per card.
    expect(screen.getAllByRole('button', { name: 'Monthly' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Annual' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    // Switching the shared toggle must not touch the Founding Family price.
    expect(screen.getByText('$29')).toBeTruthy();
  });
});
