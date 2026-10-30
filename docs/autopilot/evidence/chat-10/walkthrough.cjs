// Chat 10 headless walkthrough on the LOCAL DB only.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const BASE = 'http://localhost:3000';
const OUT = process.argv[2];
const INVITE = process.argv[3];
const EMAIL = process.argv[4];
const log = (...a) => console.log('✓', ...a);
const psql = (sql) => execFileSync('psql', ['-h', '/tmp', '-U', 'postgres', '-d', 'kindly', '-qtAc', sql]).toString().trim();
async function shot(page, name) {
  for (const w of [375, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: true });
  }
}
function assert(c, m) { if (!c) throw new Error('ASSERT: ' + m); log(m); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));

  // 1. Signed-out home → CTA
  await page.goto(BASE + '/');
  await shot(page, '01-home');
  // mobile menu
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole('button', { name: 'Menu' }).click();
  assert(await page.getByRole('button', { name: 'Close' }).getAttribute('aria-expanded') === 'true', 'mobile menu opens with aria-expanded=true');
  await page.screenshot({ path: `${OUT}/02-mobile-menu-375.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('link', { name: 'Set up the gift' }).first().click();
  await page.waitForURL(/\/signup\?next=/);
  assert(new URL(page.url()).searchParams.get('next') === '/app/onboarding', 'CTA → /signup?next=/app/onboarding');
  await shot(page, '03-signup');

  // 2. Signup → check email
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill('walkthrough-pass-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  log('signup ends on "Check your email" (no cookie, no enumeration)');

  // 3. The verify link. The fake email client never shows bodies, so mint a
  // token the same way magicLinkRepo does and build the link exactly as the
  // signup route does (route test chat10Funnel proves the emailed link carries next).
  const uid = psql(`SELECT id FROM users WHERE email = '${EMAIL}'`);
  const raw = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  psql(`INSERT INTO magic_link_tokens (user_id, token_hash, expires_at, purpose) VALUES ('${uid}', '${hash}', now() + interval '1 day', 'login')`);
  await page.goto(`${BASE}/login/verify?token=${raw}&next=${encodeURIComponent('/app/onboarding')}`);
  await page.waitForURL(/\/app\/onboarding/);
  log('verify link signs in and lands on /app/onboarding');
  await page.getByRole('heading', { name: 'Who is this for?' }).waitFor();
  await shot(page, '04-onboarding-who');

  // signed in → /signup redirects onward
  const r = await page.request.get(BASE + '/signup', { maxRedirects: 0 });
  assert(r.status() === 307 && r.headers().location.endsWith('/app/onboarding'), 'signed-in /signup → /app/onboarding');

  // 4. Onboarding
  await page.getByRole('button', { name: /Someone else/ }).click();
  await page.getByLabel('Their first name').fill('Robert');
  await page.getByLabel('They are your…').selectOption('father');
  await shot(page, '05-onboarding-profile');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('note').waitFor();
  await page.getByLabel('Something they love').fill('jazz');
  await shot(page, '06-onboarding-memories');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Start your free trial' }).waitFor();
  log('consent → billing step');

  // 5. Beta activation via the buyer's Founding Family invite link
  await page.goto(INVITE);
  // The wizard resumes an unactivated gift parent at the consent step (idempotent re-confirm).
  await page.getByRole('heading', { name: 'One important step' }).waitFor();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Join the Founding Family Beta' }).waitFor();
  await shot(page, '07-onboarding-beta');
  await page.getByRole('button', { name: 'Continue with free beta' }).click();
  await page.getByRole('heading', { name: 'Emergency alerts' }).waitFor();
  log('beta activated → Emergency alerts step');
  await page.getByLabel(/Your mobile number/).fill('(312) 555-0142');
  await page.getByRole('checkbox').check();
  await shot(page, '08-onboarding-alerts');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await page.getByRole('heading', { name: /Robert is all set/ }).waitFor();
  const phone = psql(`SELECT alert_phone || '|' || (sms_alert_consent_at IS NOT NULL) FROM users WHERE id = '${uid}'`);
  assert(phone === '+13125550142|true', 'alert phone saved as E.164 with SMS consent');

  // 6. Link created
  await page.getByRole('button', { name: 'Create talk link' }).click();
  const firstUrl = (await page.locator('code').first().textContent()).trim();
  assert(/\/app\/talk\?token=/.test(firstUrl), 'talk link created in onboarding');
  await shot(page, '09-onboarding-done');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForURL(/\/app\/family-summary/);
  log('Done → /app/family-summary');
  await shot(page, '10-family-summary');

  // first link works for the parent (separate browser, no buyer cookie)
  async function tryLink(url) {
    const pctx = await browser.newContext();
    const p = await pctx.newPage();
    await p.goto(url);
    await p.waitForTimeout(2500);
    const bad = await p.getByRole('heading', { name: /isn.t working/ }).count();
    await pctx.close();
    return bad === 0;
  }
  assert(await tryLink(firstUrl), 'first link works for the parent');

  // 7. "Talk link" nav → parent profile section; revoke → old fails; re-issue → new works
  await page.getByRole('link', { name: 'Talk link' }).click();
  await page.waitForURL(/\/app\/parent-profile#talk-link/);
  await page.getByRole('heading', { name: 'Robert’s talk link' }).waitFor();
  await page.getByText('A link is active.', { exact: false }).waitFor();
  await shot(page, '11-parent-profile-link-active');
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Turn off link' }).click();
  await page.getByText('There’s no active link right now.').waitFor();
  assert(!(await tryLink(firstUrl)), 'revoked link fails');
  await page.getByRole('button', { name: 'Make a talk link' }).click();
  const secondUrl = (await page.getByTestId('talk-url').textContent()).trim();
  await shot(page, '12-parent-profile-new-link');
  assert(secondUrl !== firstUrl, 'a new link was issued');
  assert(await tryLink(secondUrl), 'new link works');
  assert(!(await tryLink(firstUrl)), 'old link still fails');
  // Make a new link again (re-issue while active) — the second link stops working
  await page.getByRole('button', { name: 'Make a new link' }).click();
  await page.getByText('New link made. The old link no longer works.').waitFor();
  const thirdUrl = (await page.getByTestId('talk-url').textContent()).trim();
  assert(!(await tryLink(secondUrl)) && (await tryLink(thirdUrl)), 're-issue while active revokes the previous link');
  await page.getByRole('button', { name: 'Email it to me' }).click();
  await page.getByText(`Sent to ${EMAIL}.`).waitFor();
  log('email it to me');

  // 8. Account page
  await page.goto(BASE + '/app/account');
  await page.getByRole('heading', { name: 'Your account' }).waitFor();
  await page.getByText('Confirmed', { exact: true }).waitFor();
  await shot(page, '13-account');
  await page.getByRole('button', { name: 'Manage billing' }).click();
  await page.getByRole('alert').first().waitFor();
  log('Manage billing without Stripe keys → inline message: ' + (await page.getByRole('alert').first().textContent()));
  await page.getByRole('button', { name: 'Delete Robert’s profile' }).click();
  await shot(page, '14-account-delete-confirm');
  await page.getByRole('button', { name: 'Keep it' }).click();

  // 9. Invite accept page (no auto-POST)
  const tok = crypto.randomBytes(24).toString('base64url');
  const th = crypto.createHash('sha256').update(tok).digest('hex');
  const pid = psql(`SELECT id FROM parents WHERE buyer_id = '${uid}'`);
  psql(`UPDATE users SET full_name = 'Sarah Walker' WHERE id = '${uid}'`);
  psql(`INSERT INTO consents (parent_id, kind, granted_by, detail) VALUES ('${pid}', 'summary_recipient', '${uid}', '{"recipient_email":"sib@example.com","status":"pending","invite_token_hash":"${th}"}')`);
  const sctx = await browser.newContext();
  const sp = await sctx.newPage();
  await sp.goto(`${BASE}/invite/accept?token=${tok}`);
  await sp.getByRole('heading', { name: /Sarah invited you to Robert.s weekly summary/ }).waitFor();
  await sp.waitForTimeout(1000);
  assert(psql(`SELECT detail->>'status' FROM consents WHERE detail->>'invite_token_hash' = '${th}'`) === 'pending', 'opening the invite does NOT accept it');
  await shot(sp, '15-invite-accept');
  await sp.getByRole('button', { name: 'Yes, send me weekly summaries' }).click();
  await sp.getByRole('heading', { name: /on the list/ }).waitFor();
  assert(psql(`SELECT detail->>'status' FROM consents WHERE detail->>'invite_token_hash' = '${th}'`) === 'accepted', 'clicking Yes accepts');
  await sctx.close();

  // 10. Logout then a signed-out app page goes to signup with next
  await page.goto(BASE + '/app/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login$/);
  await page.goto(BASE + '/app/memories');
  assert(/\/signup\?next=%2Fapp%2Fmemories/.test(page.url()), 'signed out /app/memories → /signup?next=…');
  await browser.close();
  console.log('WALKTHROUGH OK');
})().catch((e) => { console.error(e); process.exit(1); });
