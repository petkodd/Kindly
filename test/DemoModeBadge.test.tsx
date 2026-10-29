import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DemoModeBadge, DEMO_BADGE_TEXT } from '../src/components/DemoModeBadge';

afterEach(cleanup);

describe('DemoModeBadge', () => {
  it('shows the demo label when DEMO_MODE=true', () => {
    render(<DemoModeBadge env={{ DEMO_MODE: 'true', VERCEL_ENV: 'production' }} />);
    expect(screen.getByText(DEMO_BADGE_TEXT)).toBeTruthy();
    expect(DEMO_BADGE_TEXT).toBe('Demo mode: simulated AI & voice');
  });

  it('shows locally when the AI or voice keys are missing', () => {
    render(<DemoModeBadge env={{}} />);
    expect(screen.getByRole('status').textContent).toBe(DEMO_BADGE_TEXT);
  });

  it('renders nothing when real AI and voice providers are configured', () => {
    const { container } = render(
      <DemoModeBadge env={{ AI_API_KEY: 'a', DEEPGRAM_API_KEY: 'd', ELEVENLABS_API_KEY: 'e' }} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
