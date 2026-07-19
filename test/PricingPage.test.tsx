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

  it('includes both intervals in the JSON-LD structured data', () => {
    render(<PricingPage />);
    const script = document.querySelector('script[type="application/ld+json"]');
    expect(script).toBeTruthy();
    const data = JSON.parse(script!.innerHTML);
    const offerNames = data.offers.map((o: { name: string }) => o.name);
    expect(offerNames).toContain('Family');
    expect(offerNames).toContain('Family (Annual)');
  });
});
