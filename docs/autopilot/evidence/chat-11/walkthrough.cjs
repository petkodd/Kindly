const { chromium } = require('playwright');
const { Client } = require('pg');
const BASE = 'http://localhost:3100';
const OUT = '/home/claude/kindly/docs/autopilot/evidence/chat-11';
const WIDTHS = [375, 768, 1280];
const db = new Client({ connectionString: 'postgres://kindly:kindly@localhost:5432/kindly' });
const log = (...a) => console.log('[walk]', ...a);

async function shots(page, name) {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: true });
  }
}
async function login(page, email, password) {
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/app\//, { timeout: 15000 });
}
async function signup(page, email, expectCode) {
  await page.goto(`${BASE}/signup`);
  const v = await page.inputValue('#referral-code');
  log('signup prefilled code for', email, '=', JSON.stringify(v));
  if (expectCode !== undefined && v !== expectCode) throw new Error('prefill mismatch');
  await page.fill('#email', email);
  await page.fill('#password', 'walkthrough-pass-1');
  await page.click('button:has-text("Create account")');
  await page.getByText('Check your email').waitFor();
}
async function verify(email) {
  await db.query(`UPDATE users SET email_verified_at = now() WHERE email = $1`, [email]);
}
async function makeParent(page) {
  return page.evaluate(async () => {
    const r = await fetch('/api/parents', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ first_name: 'Ruth', relationship: 'mother' }) });
    const j = await r.json();
    return j.parent?.id ?? JSON.stringify(j);
  });
}

(async () => {
  await db.connect();
  const stamp = Date.now();
  const browser = await chromium.launch();

  // A. Referrer gets a code.
  const ref = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${(Date.now()%200)+2}` } });
  const rp = await ref.newPage();
  await login(rp, 'demo@kindly.test', 'demo-pass-123');
  await rp.goto(`${BASE}/app/referrals`);
  await rp.locator('code, button:has-text("Get my code"), button:has-text("Get a new code")').first().waitFor();
  const getBtn = rp.getByRole('button', { name: /get my code|get a new code/i });
  if (await getBtn.count()) await getBtn.click();
  const code = (await rp.locator('code').first().innerText()).trim();
  log('referrer code', code);
  await shots(rp, '01-referrer-code');

  // B. New family follows ?ref link, signs up (code prefilled from the cookie).
  const fam = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `203.0.113.${(Date.now()%100)+2}` } });
  const fp = await fam.newPage();
  await fp.goto(`${BASE}/?ref=${code.toLowerCase()}`);
  const ck = (await fam.cookies()).find((c) => c.name === 'dearly_ref');
  log('cookie after ?ref', ck?.value, 'expires in days', ck ? Math.round((ck.expires - Date.now() / 1000) / 86400) : null);
  await fp.goto(`${BASE}/signup`);
  await shots(fp, '02-signup-prefilled');
  const famEmail = `family-${stamp}@example.com`;
  await signup(fp, famEmail, code);
  const { rows } = await db.query(
    `SELECT u.email FROM referrals r JOIN users u ON u.id = r.redeemed_by WHERE r.code = $1`, [code]);
  log('code redeemed by', rows[0]?.email ?? null);
  if (rows[0]?.email !== famEmail) throw new Error('signup did not redeem');

  // C. New family's onboarding checkout step shows the code as applied.
  await verify(famEmail);
  await login(fp, famEmail, 'walkthrough-pass-1');
  const pid = await makeParent(fp);
  log('family parent', pid);
  await fp.goto(`${BASE}/app/onboarding?billing=cancel&parent_id=${pid}`);
  await fp.getByText('Referral code applied').waitFor({ timeout: 15000 });
  await shots(fp, '03-onboarding-applied');

  // D. Referrer sees the redemption as pending.
  await rp.goto(`${BASE}/app/referrals`);
  await rp.getByText(/Pending: waiting for their first payment/).first().waitFor();
  await shots(rp, '04-referrer-pending');

  // E. A third family signs up without a code, then enters a fresh ?ref code at the checkout step.
  await rp.getByRole('button', { name: /get a new code/i }).click();
  await rp.locator('code').first().waitFor();
  const code2 = (await rp.locator('code').first().innerText()).trim();
  const third = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': `203.0.113.${(Date.now()%100)+120}` } });
  const tp = await third.newPage();
  const thirdEmail = `third-${stamp}@example.com`;
  await signup(tp, thirdEmail, '');
  await verify(thirdEmail);
  await login(tp, thirdEmail, 'walkthrough-pass-1');
  const pid3 = await makeParent(tp);
  await tp.goto(`${BASE}/app/onboarding?billing=cancel&parent_id=${pid3}&ref=${code2}`);
  await tp.locator('#referral-code').waitFor();
  await tp.waitForTimeout(500);
  log('checkout field prefilled', await tp.inputValue('#referral-code'));
  await shots(tp, '05-onboarding-field');
  await tp.getByRole('button', { name: /apply code/i }).click();
  await tp.getByText('Referral code applied').waitFor();
  const r2 = await db.query(`SELECT u.email FROM referrals r JOIN users u ON u.id = r.redeemed_by WHERE r.code = $1`, [code2]);
  log('code2 redeemed by', r2.rows[0]?.email);

  // F. Self-redeem is rejected in the UI (referrer applies their own new code).
  await rp.goto(`${BASE}/app/referrals`);
  await rp.getByRole('button', { name: /get a new code/i }).click();
  await rp.locator('code').first().waitFor();
  const code3 = (await rp.locator('code').first().innerText()).trim();
  const selfRes = await rp.evaluate(async (c) => {
    const r = await fetch('/api/referrals/redeem', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: c }) });
    return [r.status, (await r.json()).error?.message];
  }, code3);
  log('self redeem', selfRes);

  await browser.close();
  await db.end();
  log('OK');
})().catch(async (e) => { console.error('[walk] FAILED', e); process.exit(1); });
