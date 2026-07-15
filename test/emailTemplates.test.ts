import { describe, it, expect } from 'vitest';
import { inviteRecipientEmail } from '../src/lib/email/templates';

describe('inviteRecipientEmail', () => {
  it('escapes HTML in a buyer-controlled parent first name', () => {
    const { html } = inviteRecipientEmail({
      parentFirstName: '<img src=x onerror=alert(1)>',
      acceptUrl: 'https://kindly.example/invite/accept?token=abc',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders normal names and the accept link unescaped-looking (no stray entities)', () => {
    const { html, text } = inviteRecipientEmail({
      parentFirstName: 'Robert',
      acceptUrl: 'https://kindly.example/invite/accept?token=abc',
    });
    expect(html).toContain('<strong>Robert</strong>');
    expect(html).toContain('href="https://kindly.example/invite/accept?token=abc"');
    expect(text).toContain('Accept the invitation: https://kindly.example/invite/accept?token=abc');
  });
});
