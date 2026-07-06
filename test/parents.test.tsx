import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ParentPicker, NoParents } from '../src/components/parents';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PARENTS = [
  { id: 'p1', first_name: 'Robert' },
  { id: 'p2', first_name: 'Nadia' },
];

describe('ParentPicker', () => {
  it('renders nothing for a single parent', () => {
    const { container } = render(
      <ParentPicker parents={[PARENTS[0]]} selected="p1" onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a pill per parent and marks the selected one', () => {
    render(<ParentPicker parents={PARENTS} selected="p2" onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: 'Robert' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Nadia' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('calls onSelect with the clicked parent id', () => {
    const onSelect = vi.fn();
    render(<ParentPicker parents={PARENTS} selected="p1" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nadia' }));
    expect(onSelect).toHaveBeenCalledWith('p2');
  });
});

describe('NoParents', () => {
  it('links to onboarding', () => {
    render(<NoParents />);
    const link = screen.getByRole('link', { name: /set up the gift/i });
    expect(link.getAttribute('href')).toBe('/app/onboarding');
  });
});
