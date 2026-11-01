import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { colors, contrastRatio, contrastTable } from '../src/design/tokens.mjs';
import { FormStatus } from '../src/components/FormStatus';
import { StatusBadge } from '../src/components/StatusBadge';
import { Card } from '../src/components/Card';
import { CtaBand } from '../src/components/CtaBand';
import { inputCls, inputOnPageCls } from '../src/lib/formStyles';
import config from '../tailwind.config';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe('design tokens: WCAG contrast (chat 12)', () => {
  it('computes WCAG ratios correctly', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('every pair in the contrast table passes its AA minimum', () => {
    const failing = contrastTable().filter((r) => !r.pass);
    expect(failing).toEqual([]);
  });

  it('the audited failures are fixed', () => {
    expect(contrastRatio(colors.muted, colors.mist)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.muted, colors.cloud)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.error, colors.mist)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.cloud, colors.error)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.field, colors.mist)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.field, colors.cloud)).toBeGreaterThanOrEqual(3);
  });

  it('tailwind uses the token file, and xs/sm are floored at 16px+', () => {
    const extend = config.theme?.extend as unknown as { colors: Record<string, string>; fontSize: Record<string, [string]> };
    expect(extend.colors).toBe(colors);
    expect(parseFloat(extend.fontSize.xs[0])).toBeGreaterThanOrEqual(1);
    expect(parseFloat(extend.fontSize.sm[0])).toBeGreaterThanOrEqual(1);
  });

  it('form inputs use the ≥3:1 field border, never the decorative line', () => {
    for (const cls of [inputCls, inputOnPageCls]) {
      expect(cls).toContain('border-field');
      expect(cls).not.toContain('border-line');
      expect(cls).toContain('aria-[invalid=true]:border-error');
    }
  });
});

describe('shared components (chat 12)', () => {
  it('FormStatus error is role=alert with the message; nothing renders without one', () => {
    const { rerender, container } = render(<FormStatus kind="error" message="" />);
    expect(container.innerHTML).toBe('');
    rerender(<FormStatus kind="error" id="e1" message="That didn’t work." />);
    const alert = screen.getByRole('alert');
    expect(alert.id).toBe('e1');
    expect(alert.textContent).toBe('That didn’t work.');
    expect(alert.innerHTML).toContain('text-error');
  });

  it('FormStatus success is a polite live region that exists before the message arrives', () => {
    const { rerender } = render(<FormStatus kind="success" message="" />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    rerender(<FormStatus kind="success" message="Saved." />);
    expect(screen.getByRole('status').textContent).toBe('Saved.');
    expect(screen.getByRole('status').innerHTML).toContain('text-sageDeep');
  });

  it('StatusBadge shows its words at text-base in each tone', () => {
    render(
      <>
        <StatusBadge tone="positive">Sent</StatusBadge>
        <StatusBadge>Pending</StatusBadge>
        <StatusBadge tone="warning">Sensitive</StatusBadge>
      </>,
    );
    for (const word of ['Sent', 'Pending', 'Sensitive']) {
      expect(screen.getByText(word).className).toContain('text-base');
    }
    expect(screen.getByText('Sensitive').className).toContain('text-error');
  });

  it('Card renders as the requested element with the shared surface', () => {
    render(
      <Card as="form" aria-label="x">
        hi
      </Card>,
    );
    const form = screen.getByRole('form', { name: 'x' });
    expect(form.className).toContain('bg-cloud');
    expect(form.className).toContain('border-line');
  });

  it('CtaBand renders the heading and both tracked links', () => {
    render(
      <CtaBand
        slug="/pricing"
        cta={{ h2: 'Ready?', body: 'Body', primary: { label: 'Go', href: '/signup' }, secondary: { label: 'Wait', href: '/waitlist' } }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Ready?' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go' }).getAttribute('href')).toBe('/signup');
    expect(screen.getByRole('link', { name: 'Wait' }).getAttribute('href')).toBe('/waitlist');
  });
});

// Source guards: keep the chat 12 rules from regressing.
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx|ts|css)$/.test(f) ? [p] : [];
  });
}
const SRC = join(__dirname, '..', 'src');
const all = walk(SRC);
const appScreens = all.filter((f) => f.includes('(app)') || f.includes('(talk)'));
const read = (f: string) => readFileSync(f, 'utf8');

describe('source guards (chat 12)', () => {
  it('no text-xs / text-sm on app or parent screens', () => {
    const offenders = appScreens.filter((f) => /\btext-(xs|sm)\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('clay is decorative only: never text-clay or bg-clay', () => {
    const offenders = all.filter((f) => /\b(text|bg)-clay\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('inputs are styled through formStyles (no copied input class strings)', () => {
    const offenders = all.filter((f) => !f.endsWith('formStyles.ts') && /focus:border-sage\b|focus:ring-sage/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('no focus outline is switched off', () => {
    const offenders = all.filter((f) => /\boutline-none\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('a single Parent type lives in src/lib/types', () => {
    const offenders = all.filter((f) => !f.endsWith(join('lib', 'types.ts')) && /interface Parent\s*\{/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('the root layout has a skip link to #main, and every <main> is its target', () => {
    expect(read(join(SRC, 'app', 'layout.tsx'))).toMatch(/<a href="#main" className="skip-link">/);
    const mains = all.filter((f) => f.endsWith('.tsx') && /<main[\s>]/.test(read(f)));
    expect(mains.length).toBeGreaterThan(5);
    for (const f of mains) expect(read(f), f).toMatch(/<main id="main" tabIndex=\{-1\}/);
  });
});
