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

type Email = { subject: string; html: string; text: string };

function linkEmail(subject: string, lead: string, label: string, url: string, notes: string[]): Email {
  const text = [lead, '', url, '', ...notes].join('\n');
  const html = `
    <p>${escapeHtml(lead)}</p>
    <p><a href="${url}">${escapeHtml(label)}</a></p>
    ${notes.map((n) => `<p style="color:#666;font-size:14px">${escapeHtml(n)}</p>`).join('\n    ')}
  `.trim();
  return { subject, html, text };
}

/** Sent after signup: confirms the address and signs the new account in. */
export function verifyEmailEmail(input: { verifyUrl: string }): Email {
  return linkEmail(
    'Confirm your email for Dearly',
    'Welcome to Dearly. Please confirm your email address to finish creating your account:',
    'Confirm my email',
    input.verifyUrl,
    [
      'This link expires in 24 hours and can only be used once.',
      "If you didn't create a Dearly account, you can ignore this email.",
    ],
  );
}

/** Sent when someone signs up with an email that already has an account (never revealed on screen). */
export function accountExistsEmail(input: { loginUrl: string; resetUrl: string }): Email {
  const e = linkEmail(
    'You already have a Dearly account',
    'Someone (hopefully you) tried to create a Dearly account with this email address, but you already have one. You can sign in here:',
    'Sign in to Dearly',
    input.loginUrl,
    [
      `Forgot your password? Reset it here: ${input.resetUrl}`,
      "If this wasn't you, you can ignore this email — nothing has changed on your account.",
    ],
  );
  return e;
}

/**
 * The buyer asked for their parent's talk link by email ("Email it to me"),
 * so they can forward it or open it on the parent's tablet. Goes only to the
 * buyer's own verified-or-not account address, never to anyone else.
 */
export function talkLinkEmail(input: { parentFirstName: string; talkUrl: string }): Email {
  const name = input.parentFirstName;
  return linkEmail(
    `${name}'s Dearly talk link`,
    `Here is ${name}'s private link to talk with Dearly. Open it on the phone, tablet or computer ${name} will use, and bookmark it or add it to the home screen:`,
    `Open ${name}'s talk link`,
    input.talkUrl,
    [
      `Anyone with this link can talk with Dearly as ${name}, so share it only with ${name}.`,
      'If it is ever lost or shared by mistake, make a new link on the Parent profile page in Dearly; the old one stops working straight away.',
    ],
  );
}

/** Password reset link: sets a new password without the old one, then signs out every device. */
export function passwordResetEmail(input: { resetUrl: string }): Email {
  return linkEmail(
    'Reset your Dearly password',
    'Use this link to choose a new password for Dearly:',
    'Choose a new password',
    input.resetUrl,
    [
      'This link expires in 30 minutes and can only be used once. Setting a new password signs you out on every device.',
      "If you didn't ask for this, you can ignore this email — your password hasn't changed.",
    ],
  );
}

/**
 * Safety alert to the gift buyer on a P0/P1 flag (decision D2). Deliberately
 * short, with no transcript and no quotes: it says the parent may need help
 * and what to do, and nothing about what they said.
 */
export function safetyAlertEmail(input: {
  parentFirstName: string;
  severity: 'p0' | 'p1';
  appUrl: string;
}): { subject: string; html: string; text: string } {
  const { parentFirstName, severity, appUrl } = input;
  const level = severity === 'p0' ? 'P0 (urgent)' : 'P1 (urgent, possible medical emergency)';
  const subject = `${parentFirstName} may need help right now`;
  const lead = `${parentFirstName} may need help right now. Please call or check on them. If you think it's an emergency, call 911.`;
  const extra =
    severity === 'p0'
      ? 'If you are worried about their safety, you can also call or text 988 (the Suicide and Crisis Lifeline) for guidance.'
      : null;
  const footer = `To protect ${parentFirstName}'s privacy, this alert never includes what they said. You're receiving it because you set up Dearly for ${parentFirstName}.`;
  const text = [lead, '', ...(extra ? [extra, ''] : []), `Alert level: ${level}`, `Open Dearly: ${appUrl}`, '', footer].join('\n');
  const safeName = escapeHtml(parentFirstName);
  const safeUrl = escapeHtml(appUrl);
  const html = `
    <p><strong>${safeName} may need help right now.</strong> Please call or check on them. If you think it's an emergency, call 911.</p>
    ${extra ? `<p>${escapeHtml(extra)}</p>` : ''}
    <p>Alert level: ${escapeHtml(level)}</p>
    <p><a href="${safeUrl}">Open Dearly</a></p>
    <p style="color:#666;font-size:14px">${escapeHtml(footer)}</p>
  `.trim();
  return { subject, html, text };
}

/** The SMS version of safetyAlertEmail. Kept under two SMS segments. */
export function safetyAlertSms(input: { parentFirstName: string; severity: 'p0' | 'p1'; appUrl: string }): string {
  return (
    `Dearly alert (${input.severity.toUpperCase()}): ${input.parentFirstName} may need help right now. ` +
    `Please call or check on them. If you think it's an emergency, call 911. ${input.appUrl} Reply STOP to opt out.`
  );
}

/**
 * Internal-only alert to ADMIN_ALERT_EMAIL. Used for P3 (abuse, neglect,
 * scams — never sent to family, because the person causing harm may be
 * family) and as a backup when a P0/P1 can't reach the family. Contains no
 * names and no transcript: only the flag id, severity and why it was routed here.
 */
export function adminSafetyAlertEmail(input: {
  flagId: string;
  severity: 'p0' | 'p1' | 'p3';
  reason: string;
  adminUrl: string;
}): { subject: string; html: string; text: string } {
  const sev = input.severity.toUpperCase();
  const subject = `[Dearly safety] ${sev} flag needs review`;
  const text = [
    `A ${sev} safety flag needs review.`,
    `Why you're getting this: ${input.reason}`,
    `Flag: ${input.flagId}`,
    `Review queue: ${input.adminUrl}`,
  ].join('\n');
  const html = `
    <p>A <strong>${escapeHtml(sev)}</strong> safety flag needs review.</p>
    <p>Why you're getting this: ${escapeHtml(input.reason)}</p>
    <p>Flag: ${escapeHtml(input.flagId)}</p>
    <p><a href="${escapeHtml(input.adminUrl)}">Open the review queue</a></p>
  `.trim();
  return { subject, html, text };
}
