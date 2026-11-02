// Chat 12: axe-core accessibility run over the key screens, against a LOCAL
// production build with the seeded LOCAL database. Not part of `npm test`/CI
// because it needs a running server and Postgres. See docs/accessibility.md.
//
//   bash scripts/autopilot/setup-local-db.sh   # or any local Postgres
//   npm run db:seed && npm run build && npm start &
//   npm run test:a11y                          # BASE_URL defaults to http://localhost:3000
//
// Fails (exit 1) on any serious or critical violation. Writes a JSON report
// to $A11Y_REPORT (default: a11y-report.json, git-ignored).
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo-pass-123';
const EMAIL = process.env.A11Y_EMAIL || 'demo@kindly.test';
const REPORT = process.env.A11Y_REPORT || 'a11y-report.json';
const WIDTHS = [375, 1280];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to run against ${BASE}: local only.`);
  process.exit(2);
}

/** The seed prints a fresh parent talk link on every run; reuse it unless TALK_URL is given. */
function talkUrl() {
  if (process.env.TALK_URL) return process.env.TALK_URL;
  const out = execFileSync('node', ['db/seed.mjs'], { encoding: 'utf8' });
  const m = out.match(/https?:\/\/\S+\/app\/talk\?token=\S+/);
  if (!m) throw new Error('db:seed did not print a talk link');
  return m[0].replace(/^https?:\/\/[^/]+/, BASE);
}

async function scan(page, name, results) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    results.push({ page: name, width, url: page.url(), violations: r.violations });
    const label = `${name} @${width}`.padEnd(32);
    console.log(`${bad.length ? '✗' : '✓'} ${label} serious/critical: ${bad.length}  (all: ${r.violations.length})`);
    for (const v of r.violations) {
      console.log(`    [${v.impact}] ${v.id}: ${v.help}`);
      for (const n of v.nodes.slice(0, 4)) console.log(`        ${n.target.join(' ')}  ${(n.failureSummary || '').split('\n')[1] || ''}`);
    }
  }
}

(async () => {
  const talk = talkUrl();
  const browser = await chromium.launch();
  const results = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    for (const [name, path] of [['home', '/'], ['pricing', '/pricing'], ['signup', '/signup'], ['login', '/login'], ['not-found', '/no-such-page']]) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      await scan(page, name, results);
    }

    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/app\//);

    for (const [name, path] of [
      ['onboarding', '/app/onboarding'],
      ['parent-profile', '/app/parent-profile'],
      ['memories', '/app/memories'],
      ['family-summary', '/app/family-summary'],
      ['referrals', '/app/referrals'],
      ['account', '/app/account'],
    ]) {
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      await scan(page, name, results);
    }

    // States behind a click: the add-memory form, and an inline field error.
    await page.goto(BASE + '/app/memories', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Add a memory' }).click();
    await page.getByRole('button', { name: 'Save memory' }).click();
    await scan(page, 'memories (add, errors)', results);

    // The parent's talk screen, in a fresh context (no buyer cookie).
    const tctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const tpage = await tctx.newPage();
    await tpage.goto(talk, { waitUntil: 'networkidle' });
    await scan(tpage, 'talk', results);
    // Into the conversation: the one-time sharing notice (if shown), then the talk screen.
    await tpage.getByRole('button', { name: 'Start talking' }).click();
    const notice = tpage.getByRole('heading', { name: 'Before we chat' });
    const talkBtn = tpage.getByRole('button', { name: 'I’m done for now' });
    await Promise.race([notice.waitFor(), talkBtn.waitFor()]);
    if (await notice.isVisible()) {
      await scan(tpage, 'talk (sharing notice)', results);
      await tpage.getByRole('button', { name: 'Yes' }).click();
      await talkBtn.waitFor();
    }
    await tpage.waitForLoadState('networkidle');
    await scan(tpage, 'talk (conversation)', results);
  } finally {
    await browser.close();
  }

  writeFileSync(REPORT, JSON.stringify(results, null, 2));
  const serious = results.flatMap((r) => r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'));
  console.log(`\n${serious.length === 0 ? 'PASS' : 'FAIL'}: ${serious.length} serious/critical violation(s) across ${results.length} scans. Report: ${REPORT}`);
  process.exit(serious.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
