import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ParentPicker } from '../src/components/ParentPicker';

const PARENTS = [
  { id: 'p1', first_name: 'Robert' },
  { id: 'p2', first_name: 'Mary' },
];

afterEach(cleanup);

describe('ParentPicker', () => {
  it('renders a pill per parent and marks the selected one', () => {
    render(<ParentPicker parents={PARENTS} selected="p2" onSelect={() => {}} />);
    const robert = screen.getByRole('button', { name: 'Robert' });
    const mary = screen.getByRole('button', { name: 'Mary' });
    expect(robert.getAttribute('aria-pressed')).toBe('false');
    expect(mary.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls onSelect with the parent id when a pill is clicked', () => {
    const onSelect = vi.fn();
    render(<ParentPicker parents={PARENTS} selected="p1" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mary' }));
    expect(onSelect).toHaveBeenCalledWith('p2');
  });

  it('renders nothing (not even a wrapper) for a single parent', () => {
    const { container } = render(
      <ParentPicker parents={[PARENTS[0]]} selected="p1" onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
