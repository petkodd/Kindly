/** Plain, warm transactional copy — no marketing language, matches FOOTER_LEGAL tone. */
export function inviteRecipientEmail(input: {
  parentFirstName: string;
  acceptUrl: string;
}): { subject: string; html: string; text: string } {
  const { parentFirstName, acceptUrl } = input;
  const subject = `You've been invited to ${parentFirstName}'s weekly Kindly summary`;
  const text = [
    `You've been invited to receive a weekly, respectful summary of how ${parentFirstName} is doing.`,
    '',
    `Kindly is a voice-first AI companion ${parentFirstName} can talk to. Each week, family who accept get a short, warm update — never a raw transcript.`,
    '',
    `Accept the invitation: ${acceptUrl}`,
    '',
    "If you weren't expecting this, you can ignore this email.",
  ].join('\n');
  const html = `
    <p>You've been invited to receive a weekly, respectful summary of how <strong>${parentFirstName}</strong> is doing.</p>
    <p>Kindly is a voice-first AI companion ${parentFirstName} can talk to. Each week, family who accept get a short, warm update — never a raw transcript.</p>
    <p><a href="${acceptUrl}">Accept the invitation</a></p>
    <p style="color:#666;font-size:14px">If you weren't expecting this, you can ignore this email.</p>
  `.trim();
  return { subject, html, text };
}

/** Plain, warm transactional copy for a passwordless sign-in link. */
export function magicLinkEmail(input: { verifyUrl: string }): { subject: string; html: string; text: string } {
  const { verifyUrl } = input;
  const subject = 'Your Kindly sign-in link';
  const text = [
    'Use this link to sign in to Kindly:',
    '',
    verifyUrl,
    '',
    'This link expires in 15 minutes and can only be used once.',
    '',
    "If you didn't request this, you can ignore this email — your account is safe.",
  ].join('\n');
  const html = `
    <p>Use this link to sign in to Kindly:</p>
    <p><a href="${verifyUrl}">Sign in to Kindly</a></p>
    <p style="color:#666;font-size:14px">This link expires in 15 minutes and can only be used once.</p>
    <p style="color:#666;font-size:14px">If you didn't request this, you can ignore this email — your account is safe.</p>
  `.trim();
  return { subject, html, text };
}
