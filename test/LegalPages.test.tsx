import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
import { render, screen, cleanup, within } from '@testing-library/react';
import PrivacyPage, { metadata as privacyMeta } from '../src/app/(public)/privacy/page';
import TermsPage, { metadata as termsMeta } from '../src/app/(public)/terms/page';
import { metadata as trustMeta } from '../src/app/(public)/trust-and-privacy/page';
import sitemap from '../src/app/sitemap';
import { SiteFooter } from '../src/components/SiteFooter';
import SignupPage from '../src/app/signup/page';
import { SITE } from '../src/lib/seo';

afterEach(() => cleanup());

describe('/privacy and /terms (chat 9)', () => {
  it.each([
    ['privacy', PrivacyPage, 'Privacy Policy'],
    ['terms', TermsPage, 'Terms of Use'],
  ] as const)('/%s: draft banner, exactly one H1, H2 sections', (_slug, Page, h1) => {
    const { container } = render(<Page />);
    expect(screen.getByRole('note').textContent).toBe('DRAFT — requires legal review');
    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe(h1);
    expect(container.querySelectorAll('h2').length).toBeGreaterThanOrEqual(5);
  });

  it('the privacy policy covers data, every vendor, retention, rights and contact', () => {
    const { container } = render(<PrivacyPage />);
    const text = container.textContent ?? '';
    for (const v of ['Anthropic', 'Deepgram', 'ElevenLabs', 'Resend', 'Twilio', 'Stripe', 'Sentry', 'Vercel']) {
      expect(text).toContain(v);
    }
    expect(text).toMatch(/transcripts are deleted automatically 30 days/);
    expect(text).toMatch(/permanently purged within 30 days/);
    expect(text).toMatch(/Export:/);
    expect(text).toMatch(/Delete:/);
    expect(text).toMatch(/never the conversation word for word/);
    expect(screen.getByRole('heading', { level: 2, name: 'Contact us' })).toBeTruthy();
  });

  it('has unique titles and descriptions, canonical URLs and is indexable', () => {
    expect(privacyMeta.title).not.toBe(termsMeta.title);
    expect(privacyMeta.title).not.toBe(trustMeta.title);
    expect(privacyMeta.description).not.toBe(termsMeta.description);
    expect(privacyMeta.alternates?.canonical).toBe(`${SITE.url}/privacy`);
    expect(termsMeta.alternates?.canonical).toBe(`${SITE.url}/terms`);
    expect(privacyMeta.robots).toEqual({ index: true, follow: true });
    expect(termsMeta.robots).toEqual({ index: true, follow: true });
  });

  it('both are in the sitemap', () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain(`${SITE.url}/privacy`);
    expect(urls).toContain(`${SITE.url}/terms`);
  });

  it('are linked from the footer and the signup page', () => {
    const footer = render(<SiteFooter />);
    const f = within(footer.container);
    expect(f.getByRole('link', { name: 'Privacy policy' }).getAttribute('href')).toBe('/privacy');
    expect(f.getByRole('link', { name: 'Terms of use' }).getAttribute('href')).toBe('/terms');
    cleanup();
    render(<SignupPage />);
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy');
    expect(screen.getByRole('link', { name: 'Terms of Use' }).getAttribute('href')).toBe('/terms');
  });
});
