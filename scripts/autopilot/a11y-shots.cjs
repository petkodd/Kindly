// Chat 12: before/after screenshots of the key screens at 375 and 1280 widths.
// LOCAL ONLY: needs `npm run build && npm start` against the seeded local DB.
// Usage: node scripts/autopilot/a11y-shots.cjs <outDir> <prefix> [talkUrl]
const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const [OUT, PREFIX, TALK] = process.argv.slice(2);
const PASS = process.env.DEMO_PASSWORD || 'demo-pass-123';

async function shot(page, name) {
  for (const w of [375, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${PREFIX}-${name}-${w}.png`, fullPage: true });
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  for (const [name, path] of [['home', '/'], ['pricing', '/pricing'], ['signup', '/signup'], ['not-found', '/no-such-page']]) {
    await page.goto(BASE + path);
    await shot(page, name);
  }
  await page.goto(BASE + '/login');
  await page.getByLabel('Email').fill('demo@kindly.test');
  await page.getByLabel('Password').fill(PASS);
  await page.getByRole('button', { name: /^Log in|^Sign in/ }).click();
  await page.waitForURL(/\/app\//);
  for (const [name, path] of [
    ['onboarding', '/app/onboarding'],
    ['parent-profile', '/app/parent-profile'],
    ['memories', '/app/memories'],
    ['family-summary', '/app/family-summary'],
    ['referrals', '/app/referrals'],
    ['account', '/app/account'],
  ]) {
    await page.goto(BASE + path);
    await page.waitForLoadState('networkidle');
    await shot(page, name);
  }
  if (TALK) {
    const p2 = await (await browser.newContext()).newPage();
    await p2.goto(TALK);
    await p2.waitForLoadState('networkidle');
    await shot(p2, 'talk');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
