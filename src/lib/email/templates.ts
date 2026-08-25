/** Escape text interpolated into an HTML email body — buyer-controlled fields
 *  like a parent's first name must never be trusted as raw markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain, warm transactional copy — no marketing language, matches FOOTER_LEGAL tone. */
export function inviteRecipientEmail(input: {
  parentFirstName: string;
  acceptUrl: string;
}): { subject: string; html: string; text: string } {
  const { parentFirstName, acceptUrl } = input;
  const subject = `You've been invited to ${parentFirstName}'s weekly Dearly summary`;
  const text = [
    `You've been invited to receive a weekly, respectful summary of how ${parentFirstName} is doing.`,
    '',
    `Dearly is a voice-first AI companion ${parentFirstName} can talk to. Each week, family who accept get a short, warm update — never a raw transcript.`,
    '',
    `Accept the invitation: ${acceptUrl}`,
    '',
    "If you weren't expecting this, you can ignore this email.",
  ].join('\n');
  const safeName = escapeHtml(parentFirstName);
  const safeUrl = escapeHtml(acceptUrl);
  const html = `
    <p>You've been invited to receive a weekly, respectful summary of how <strong>${safeName}</strong> is doing.</p>
    <p>Dearly is a voice-first AI companion ${safeName} can talk to. Each week, family who accept get a short, warm update — never a raw transcript.</p>
    <p><a href="${safeUrl}">Accept the invitation</a></p>
    <p style="color:#666;font-size:14px">If you weren't expecting this, you can ignore this email.</p>
  `.trim();
  return { subject, html, text };
}

/** Plain, warm transactional copy for the weekly family summary. `bodyLong` is
 *  already family-safe, respectful, non-clinical prose (see composeBody in
 *  repos/summary.ts) — this only wraps it in subject/HTML/text framing. */
export function weeklySummaryEmail(input: {
  parentFirstName: string;
  bodyLong: string;
}): { subject: string; html: string; text: string } {
  const { parentFirstName, bodyLong } = input;
  const subject = `${parentFirstName}'s week with Dearly`;
  const text = [
    bodyLong,
    '',
    "You're receiving this because you accepted an invitation to get weekly updates about " +
      `${parentFirstName}. This is never a raw transcript.`,
  ].join('\n');
  const safeName = escapeHtml(parentFirstName);
  const htmlLines = escapeHtml(bodyLong)
    .split('\n')
    .map((line) => (line ? `<p>${line}</p>` : ''))
    .join('\n');
  const html = `
    <h2>${safeName}'s week with Dearly</h2>
    ${htmlLines}
    <p style="color:#666;font-size:14px">You're receiving this because you accepted an invitation to get weekly updates about ${safeName}. This is never a raw transcript.</p>
  `.trim();
  return { subject, html, text };
}

/** Plain, warm transactional copy for a passwordless sign-in link. */
export function magicLinkEmail(input: { verifyUrl: string }): { subject: string; html: string; text: string } {
  const { verifyUrl } = input;
  const subject = 'Your Dearly sign-in link';
  const text = [
    'Use this link to sign in to Dearly:',
    '',
    verifyUrl,
    '',
    'This link expires in 15 minutes and can only be used once.',
    '',
    "If you didn't request this, you can ignore this email — your account is safe.",
  ].join('\n');
  const html = `
    <p>Use this link to sign in to Dearly:</p>
    <p><a href="${verifyUrl}">Sign in to Dearly</a></p>
    <p style="color:#666;font-size:14px">This link expires in 15 minutes and can only be used once.</p>
    <p style="color:#666;font-size:14px">If you didn't request this, you can ignore this email — your account is safe.</p>
  `.trim();
  return { subject, html, text };
}
