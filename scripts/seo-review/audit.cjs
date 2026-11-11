// SEO Reviewer — automated technical & on-page SEO audit.
//
// Crawls the public site of a LOCAL production build the way a search engine
// does (raw HTML first, no JavaScript), then renders it, and records for every
// URL it can reach from the home page, the sitemap and the known route list:
//   • HTTP: status, redirects, X-Robots-Tag, trailing-slash and case variants
//   • indexability: meta robots, canonical (absolute, self-referencing, in sitemap)
//   • on-page: title / description length + uniqueness, one H1, heading outline,
//              word count, target keyword placement (title, H1, description,
//              first 100 words, slug), html lang, viewport
//   • social: Open Graph + Twitter tags, OG image reachable and 1200×630
//   • structured data: every JSON-LD block parsed, @types listed, required fields
//   • links: internal link graph (inlinks per page, orphans, links to
//            noindex / 4xx / redirects), anchor texts, external links
//   • images: alt, width/height, lazy loading, format, bytes
//   • content needing JS: H1 / text present only after rendering
//   • robots.txt + sitemap.xml: parse, every URL 200 + indexable + canonical match
//   • private pages: /app/*, /login, /signup, /admin, /invite are noindex
//   • Lighthouse (mobile) performance / accessibility / best-practices / SEO,
//     LCP, CLS, TBT per indexable page (skipped with LIGHTHOUSE=0)
//
//   npm run build && npm start &
//   node scripts/seo-review/audit.cjs                  # OUT defaults to seo-review-out/
//
// Build with NEXT_PUBLIC_SITE_URL=http://localhost:3000 so canonicals and the
// sitemap point at the server being audited. Local only.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const OUT = process.env.OUT || 'seo-review-out';
const LIGHTHOUSE = process.env.LIGHTHOUSE !== '0';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`Refusing to run against ${BASE}: local only.`);
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

// Target keyword per public page (project SEO targets). Pages not listed have no target.
const KEYWORDS = JSON.parse(process.env.KEYWORDS || 'null') || {
  '/': 'AI companion for aging parents',
  '/gift-for-aging-parent': 'gift for elderly parent',
  '/how-it-works': 'AI companion for seniors',
  '/pricing': 'senior companion app',
  '/trust-and-privacy': 'family updates for aging parents',
  '/senior-living': 'AI companion for senior living',
};
// The project's full target list; any target no page owns is a content gap.
const ALL_TARGETS = [
  'AI companion for aging parents', 'gift for elderly parent', 'AI companion for seniors', 'lonely aging parent',
  'senior companion app', 'AI companion for elderly', 'family updates for aging parents',
  'senior living resident engagement software', 'AI companion for senior living', 'care home family engagement platform',
];
const KNOWN_PUBLIC = ['/', '/how-it-works', '/gift-for-aging-parent', '/pricing', '/trust-and-privacy', '/senior-living',
  '/waitlist', '/blog', '/privacy', '/terms'];
const PRIVATE = ['/login', '/signup', '/login/forgot', '/login/reset', '/login/verify', '/invite/accept', '/admin',
  '/app/onboarding', '/app/parent-profile', '/app/memories', '/app/family-summary', '/app/referrals', '/app/account', '/app/talk'];

const norm = (u) => { try { const x = new URL(u, BASE); return x.origin === new URL(BASE).origin ? (x.pathname.replace(/\/$/, '') || '/') : null; } catch { return null; } };

async function head(url) {
  const t = Date.now();
  const r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' } });
  const body = r.status === 200 ? await r.text() : '';
  return { status: r.status, location: r.headers.get('location'), xRobots: r.headers.get('x-robots-tag'),
    cache: r.headers.get('cache-control'), type: r.headers.get('content-type'), ms: Date.now() - t, bytes: body.length, body };
}

// Runs inside the page (JS on or off). Returns plain JSON.
function extract() {
  const m = (sel, attr = 'content') => document.querySelector(sel)?.getAttribute(attr) ?? null;
  const main = document.querySelector('main') || document.body;
  const text = (main.innerText || main.textContent || '').replace(/\s+/g, ' ').trim();
  const jsonld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
    try { return { ok: true, data: JSON.parse(s.textContent) }; } catch (e) { return { ok: false, error: String(e) }; }
  });
  return {
    title: document.title, description: m('meta[name="description"]'), robots: m('meta[name="robots"]'),
    canonical: m('link[rel="canonical"]', 'href'), lang: document.documentElement.getAttribute('lang'),
    viewport: m('meta[name="viewport"]'), hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => l.hreflang),
    og: Object.fromEntries([...document.querySelectorAll('meta[property^="og:"]')].map((x) => [x.getAttribute('property'), x.content])),
    twitter: Object.fromEntries([...document.querySelectorAll('meta[name^="twitter:"]')].map((x) => [x.name, x.content])),
    h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()),
    outline: [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => `${h.tagName}: ${h.textContent.replace(/\s+/g, ' ').trim().slice(0, 80)}`),
    words: text ? text.split(' ').length : 0, first100: text.split(' ').slice(0, 100).join(' '),
    links: [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60), rel: a.rel, inNav: !!a.closest('header,nav,footer') })),
    images: [...document.querySelectorAll('img')].map((i) => ({ src: i.getAttribute('src'), alt: i.getAttribute('alt'), w: i.getAttribute('width'), h: i.getAttribute('height'), loading: i.getAttribute('loading'), fetchpriority: i.getAttribute('fetchpriority') })),
    jsonld, favicon: !!document.querySelector('link[rel~="icon"]'), manifest: m('link[rel="manifest"]', 'href'),
  };
}

function check(p, raw, rendered, http, ctx) {
  const issues = [];
  const add = (sev, rule, detail = '') => issues.push({ sev, rule, detail });
  const indexable = !/noindex/i.test(raw.robots || '') && !/noindex/i.test(http.xRobots || '');
  const expectedCanonical = `${ctx.siteUrl}${p === '/' ? '' : p}`;
  if (!indexable) {
    if (raw.h1.length !== 1) add('LOW', `${raw.h1.length} H1`);
    if (http.status !== 200) add('CRITICAL', `status ${http.status}`);
    return { indexable, issues, types: [] };
  }
  // Title / description.
  const tl = (raw.title || '').length, dl = (raw.description || '').length;
  if (!raw.title) add('HIGH', 'missing <title>');
  else if (tl > 60) add('MEDIUM', `title ${tl} chars (>60, may be cut)`, raw.title);
  else if (tl < 30) add('LOW', `title ${tl} chars (<30)`, raw.title);
  if (!raw.description) add('HIGH', 'missing meta description');
  else if (dl > 160) add('MEDIUM', `description ${dl} chars (>160)`);
  else if (dl < 110) add('LOW', `description ${dl} chars (<110)`);
  // Indexing signals.
  if (!raw.canonical) add('HIGH', 'missing canonical');
  else {
    if (!/^https?:\/\//.test(raw.canonical)) add('HIGH', 'canonical is not absolute', raw.canonical);
    if (indexable && raw.canonical.replace(/\/$/, '') !== expectedCanonical.replace(/\/$/, '')) add('HIGH', 'canonical is not self-referencing', `${raw.canonical} ≠ ${expectedCanonical}`);
    if (/example\.com/.test(raw.canonical)) add('CRITICAL', 'canonical points at the placeholder domain', raw.canonical);
  }
  if (indexable && !ctx.sitemap.has(p)) add('HIGH', 'indexable page missing from sitemap');
  if (!indexable && ctx.sitemap.has(p)) add('HIGH', 'noindex page listed in sitemap');
  if (raw.h1.length !== 1) add(indexable ? 'HIGH' : 'LOW', `${raw.h1.length} H1 in raw HTML`, raw.h1.join(' | '));
  if (rendered && raw.h1.join() !== rendered.h1.join()) add('MEDIUM', 'H1 differs between raw HTML and rendered page (needs JS)', `${raw.h1} → ${rendered.h1}`);
  if (rendered && rendered.words > 50 && raw.words < rendered.words * 0.8) add('HIGH', 'content only appears after JavaScript', `${raw.words} words raw vs ${rendered.words} rendered`);
  if (!raw.lang) add('MEDIUM', 'no <html lang>');
  else if (!/^en(-US)?$/i.test(raw.lang)) add('LOW', `html lang="${raw.lang}" (US site: en-US)`);
  if (!raw.viewport) add('HIGH', 'no viewport meta');
  // Heading outline.
  const levels = raw.outline.map((o) => +o[1]);
  levels.forEach((l, i) => { if (i && l > levels[i - 1] + 1) add('LOW', `heading skip h${levels[i - 1]}→h${l}`, raw.outline[i]); });
  if (indexable && raw.words < 300 && p !== '/waitlist') add('MEDIUM', `thin content: ${raw.words} words`);
  // Social.
  for (const k of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type']) if (!raw.og[k]) add('MEDIUM', `missing ${k}`);
  if (raw.og['og:url'] && raw.canonical && raw.og['og:url'] !== raw.canonical) add('LOW', 'og:url ≠ canonical');
  if (!raw.twitter['twitter:card']) add('LOW', 'missing twitter:card');
  if (raw.og['og:image'] && ctx.ogImages[raw.og['og:image']] && !ctx.ogImages[raw.og['og:image']].ok) add('HIGH', 'og:image not reachable / wrong size', JSON.stringify(ctx.ogImages[raw.og['og:image']]));
  if (indexable && ctx.ogTitles[raw.og['og:image']] > 1) add('LOW', 'same og:image on every page (no page-specific share image)');
  // Structured data.
  const types = [];
  for (const j of raw.jsonld) {
    if (!j.ok) { add('HIGH', 'invalid JSON-LD', j.error); continue; }
    const items = j.data['@graph'] || [j.data];
    for (const it of items) {
      types.push(it['@type']);
      if (it['@type'] === 'Organization' && (!it.logo || !it.url)) add('MEDIUM', 'Organization without logo/url');
      if (it['@type'] === 'Organization' && !it.sameAs) add('LOW', 'Organization has no sameAs (social profiles)');
      if (it['@type'] === 'FAQPage' && !(it.mainEntity || []).length) add('HIGH', 'FAQPage without questions');
      if (it['@type'] === 'Product' && !(it.offers)) add('HIGH', 'Product without offers');
      if (it['@type'] === 'Product' && !it.image) add('MEDIUM', 'Product without image (required for merchant/product snippets)');
      if (JSON.stringify(it).includes('example.com')) add('CRITICAL', `JSON-LD ${it['@type']} uses the placeholder domain`);
    }
  }
  if (indexable && !types.length) add('LOW', 'no structured data');
  if (indexable && p !== '/' && !types.includes('BreadcrumbList')) add('LOW', 'no BreadcrumbList');
  // Keyword placement.
  const kw = KEYWORDS[p];
  if (kw) {
    const has = (s) => s && s.toLowerCase().includes(kw.toLowerCase());
    const loose = (s) => s && kw.toLowerCase().split(' ').filter((w) => w.length > 3).every((w) => s.toLowerCase().includes(w.replace(/s$/, '')));
    const where = { title: has(raw.title), h1: has(raw.h1.join(' ')), description: has(raw.description), first100: has(raw.first100) };
    const missing = Object.entries(where).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) add(missing.includes('title') || missing.includes('h1') ? 'MEDIUM' : 'LOW',
      `target "${kw}" missing from ${missing.join(', ')}`, Object.entries(where).filter(([k, v]) => !v && loose(k === 'title' ? raw.title : k === 'h1' ? raw.h1.join(' ') : k === 'description' ? raw.description : raw.first100)).map(([k]) => `${k}: has the words but not the phrase`).join('; '));
  }
  // Images.
  for (const i of raw.images) {
    if (i.alt === null) add('MEDIUM', 'image without alt', i.src);
    if (!i.w || !i.h) add('LOW', 'image without width/height (CLS risk)', i.src);
  }
  // Links.
  for (const l of raw.links) {
    const t = norm(l.href);
    if (t && ctx.status[t] && ctx.status[t] >= 400) add('HIGH', `link to ${ctx.status[t]}`, `${l.href} "${l.text}"`);
    if (t && ctx.status[t] && ctx.status[t] >= 300 && ctx.status[t] < 400) add('LOW', `link to a redirect (${ctx.status[t]})`, l.href);
    if (!l.text) add('MEDIUM', 'link with no text', l.href);
    if (/^(click here|read more|learn more|here|more)$/i.test(l.text)) add('LOW', 'generic anchor text', `${l.text} → ${l.href}`);
  }
  if (http.status !== 200) add('CRITICAL', `status ${http.status}`);
  if (!/no-store|private/.test(http.cache || '') && http.ms > 800) add('LOW', `slow HTML response ${http.ms}ms`);
  return { indexable, issues, types };
}

(async () => {
  const report = { base: BASE, generatedAt: new Date().toISOString(), pages: {}, site: [] };
  const siteIssue = (sev, rule, detail = '') => report.site.push({ sev, rule, detail });

  // robots.txt + sitemap.
  const robots = await head(`${BASE}/robots.txt`);
  report.robotsTxt = robots.body;
  if (robots.status !== 200) siteIssue('CRITICAL', 'robots.txt missing');
  const sitemapRef = robots.body.match(/Sitemap:\s*(\S+)/i)?.[1];
  if (!sitemapRef) siteIssue('HIGH', 'robots.txt has no Sitemap line');
  if (sitemapRef && /example\.com/.test(sitemapRef)) siteIssue('CRITICAL', 'robots.txt Sitemap points at the placeholder domain', sitemapRef);
  const sm = await head(`${BASE}/sitemap.xml`);
  const smUrls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]);
  const siteUrl = (smUrls[0] && new URL(smUrls[0]).origin) || BASE;
  if (/example\.com/.test(siteUrl)) siteIssue('CRITICAL', 'sitemap URLs use the placeholder domain', siteUrl);
  if (siteUrl !== BASE) siteIssue('MEDIUM', `sitemap origin ${siteUrl} ≠ audited ${BASE} (rebuild with NEXT_PUBLIC_SITE_URL=${BASE} for a clean run)`);
  const sitemap = new Set(smUrls.map((u) => new URL(u).pathname.replace(/\/$/, '') || '/'));
  const lastmods = [...sm.body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((x) => x[1]);
  if (new Set(lastmods).size === 1 && lastmods.length > 3) siteIssue('LOW', 'every sitemap lastmod is identical', lastmods[0]);
  for (const disallowed of ['/app/', '/admin', '/api/']) if (!robots.body.includes(disallowed)) siteIssue('MEDIUM', `robots.txt does not disallow ${disallowed}`);
  if (/Disallow: \/app\//.test(robots.body)) siteIssue('LOW', 'robots.txt disallows /app/: Google can’t see the noindex on those pages, so a linked private URL can still show up as "Indexed, though blocked by robots.txt". Prefer allowing crawl + noindex/X-Robots-Tag, or keep both and accept it.');

  // Crawl: known routes + sitemap + links found.
  const queue = [...new Set([...KNOWN_PUBLIC, ...sitemap])];
  const status = {};
  const raw = {};
  const browser = await chromium.launch();
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 412, height: 915 }, userAgent: 'Mozilla/5.0 (Linux; Android 10; Pixel) Googlebot/2.1' });
  const js = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const http = {};
  for (let i = 0; i < queue.length && i < 80; i++) {
    const p = queue[i];
    const h = await head(BASE + p);
    status[p] = h.status;
    http[p] = h;
    if (h.status !== 200 || !/html/.test(h.type || '')) continue;
    const pg = await noJs.newPage();
    await pg.setContent(h.body, { waitUntil: 'domcontentloaded' });
    raw[p] = await pg.evaluate(extract);
    await pg.close();
    for (const l of raw[p].links) { const t = norm(l.href); if (t && !t.startsWith('/api') && !queue.includes(t) && !/\.(png|jpg|svg|xml|txt|webmanifest|ico)$/.test(t)) queue.push(t); }
  }
  // Link status for discovered targets not crawled (private, redirects).
  for (const p of PRIVATE) if (!(p in status)) { const h = await head(BASE + p); status[p] = h.status; http[p] = h; }

  // OG images.
  const ogImages = {}; const ogTitles = {};
  for (const r of Object.values(raw)) {
    const img = r.og['og:image']; if (!img) continue;
    ogTitles[img] = (ogTitles[img] || 0) + 1;
    if (ogImages[img]) continue;
    const local = img.replace(/^https?:\/\/[^/]+/, BASE);
    const res = await fetch(local).catch(() => null);
    let dims = null;
    if (res && res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.slice(1, 4).toString() === 'PNG') dims = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
      ogImages[img] = { ok: !dims || (dims.w >= 1200 && dims.h >= 630), status: res.status, ...dims, kb: Math.round(buf.length / 1024) };
    } else ogImages[img] = { ok: false, status: res?.status };
  }

  // Per-page checks (+ rendered comparison).
  const ctx = { siteUrl, sitemap, status, ogImages, ogTitles };
  for (const [p, r] of Object.entries(raw)) {
    const pg = await js.newPage();
    await pg.goto(BASE + p, { waitUntil: 'networkidle' });
    const rendered = await pg.evaluate(extract);
    await pg.close();
    const c = check(p, r, rendered, http[p], ctx);
    report.pages[p] = { ...c, status: http[p].status, ms: http[p].ms, kb: Math.round(http[p].bytes / 1024), xRobots: http[p].xRobots,
      title: r.title, description: r.description, canonical: r.canonical, robots: r.robots, h1: r.h1, outline: r.outline, words: r.words,
      og: r.og, links: r.links.length, images: r.images.length, keyword: KEYWORDS[p] || null };
  }

  // Private pages must be noindex.
  report.private = {};
  for (const p of PRIVATE) {
    const h = http[p];
    let robotsMeta = null;
    if (h.status === 200) { const pg = await noJs.newPage(); await pg.setContent(h.body); robotsMeta = await pg.evaluate(() => document.querySelector('meta[name=robots]')?.content ?? null); await pg.close(); }
    const ok = /noindex/i.test(robotsMeta || '') || /noindex/i.test(h.xRobots || '') || (h.status >= 300 && h.status < 400);
    report.private[p] = { status: h.status, robots: robotsMeta, xRobots: h.xRobots, ok };
    if (!ok) siteIssue('HIGH', `private page ${p} is indexable`, `status ${h.status}, robots ${robotsMeta}`);
    if (sitemap.has(p)) siteIssue('HIGH', `private page ${p} in sitemap`);
  }

  // Duplicates.
  const dup = (field) => { const seen = {}; for (const [p, r] of Object.entries(report.pages)) if (r.indexable && r[field]) (seen[r[field]] ||= []).push(p); return Object.entries(seen).filter(([, v]) => v.length > 1); };
  for (const [v, ps] of dup('title')) siteIssue('HIGH', 'duplicate title', `${v} — ${ps.join(', ')}`);
  for (const [v, ps] of dup('description')) siteIssue('HIGH', 'duplicate description', `${v.slice(0, 60)}… — ${ps.join(', ')}`);

  // Internal link graph.
  const inlinks = {}; const anchors = {};
  for (const [from, r] of Object.entries(raw)) for (const l of r.links) { const t = norm(l.href); if (!t || t === from) continue; (inlinks[t] ||= new Set()).add(from); if (!l.inNav) (anchors[t] ||= new Set()).add(l.text); }
  report.linkGraph = {};
  for (const [p, r] of Object.entries(report.pages)) {
    const n = inlinks[p]?.size || 0;
    report.linkGraph[p] = { inlinks: n, contextualAnchors: [...(anchors[p] || [])] };
    if (r.indexable && p !== '/' && n === 0) siteIssue('HIGH', `orphan page ${p}`);
    if (r.indexable && p !== '/' && !(anchors[p] || new Set()).size) r.issues.push({ sev: 'LOW', rule: 'no contextual (in-content) links point here; only header/footer', detail: '' });
  }
  for (const p of ['/404-check-' + Date.now()]) { const h = await head(BASE + p); if (h.status !== 404) siteIssue('HIGH', `unknown URL returns ${h.status}, not 404`); }
  for (const [v, want] of [['/pricing/', 'redirect to /pricing'], ['/Pricing', '404 or redirect'], ['/pricing?utm_source=x', 'canonical without query']]) {
    const h = await head(BASE + v); report.site.push({ sev: 'INFO', rule: `${v} → ${h.status}${h.location ? ' ' + h.location : ''}`, detail: want });
  }
  const titles = Object.values(report.pages).filter((r) => r.indexable).map((r) => `${r.title} ${r.h1.join(' ')}`.toLowerCase()).join(' ');
  const covered = new Set(Object.values(KEYWORDS).map((k) => k.toLowerCase()));
  for (const t of ALL_TARGETS) if (!covered.has(t.toLowerCase()) && !titles.includes(t.toLowerCase())) siteIssue('MEDIUM', `content gap: no page targets "${t}"`);
  if (!Object.keys(raw).some((p) => p.startsWith('/blog/'))) siteIssue('MEDIUM', 'no blog articles published (blog index stays noindex until 3+)');

  // Lighthouse (mobile) on indexable pages.
  report.lighthouse = {};
  if (LIGHTHOUSE) {
    const chrome = chromium.executablePath();
    for (const [p, r] of Object.entries(report.pages)) {
      if (!r.indexable && p !== '/blog') continue;
      try {
        const outFile = path.join(OUT, `lh-${(p === '/' ? 'home' : p.replace(/\W+/g, '_'))}.json`);
        execFileSync('npx', ['-y', 'lighthouse@12', BASE + p, '--quiet', '--output=json', `--output-path=${outFile}`, '--only-categories=performance,accessibility,best-practices,seo',
          '--chrome-flags=--headless=new --no-sandbox'], { env: { ...process.env, CHROME_PATH: chrome }, stdio: 'ignore', timeout: 180000 });
        const lh = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        const s = (c) => Math.round(lh.categories[c].score * 100);
        const a = lh.audits;
        report.lighthouse[p] = { perf: s('performance'), a11y: s('accessibility'), bp: s('best-practices'), seo: s('seo'),
          lcp: a['largest-contentful-paint'].displayValue, cls: a['cumulative-layout-shift'].displayValue, tbt: a['total-blocking-time'].displayValue,
          failedSeo: lh.categories.seo.auditRefs.filter((x) => lh.audits[x.id].score === 0).map((x) => x.id),
          topOpportunities: Object.values(a).filter((x) => x.details?.type === 'opportunity' && x.numericValue > 150).sort((x, y) => y.numericValue - x.numericValue).slice(0, 4).map((x) => `${x.title} (${x.displayValue || ''})`) };
        console.log(`lighthouse ${p.padEnd(24)} ${JSON.stringify(report.lighthouse[p]).slice(0, 160)}`);
      } catch (e) { report.lighthouse[p] = { error: String(e).slice(0, 200) }; }
    }
  }
  await browser.close();

  fs.writeFileSync(path.join(OUT, 'seo-audit.json'), JSON.stringify(report, null, 2));
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  const L = ['# SEO audit (automated)', '', `Base ${BASE} · site URL in sitemap ${siteUrl} · ${report.generatedAt}`, '',
    '## Site-wide', '', ...report.site.sort((a, b) => order[a.sev] - order[b.sev]).map((i) => `- **${i.sev}** ${i.rule}${i.detail ? ` — ${i.detail}` : ''}`), '',
    '## Pages', '', '| Page | Status | Index | Title (len) | Desc len | H1 | Words | In-links | JSON-LD | Issues |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const [p, r] of Object.entries(report.pages)) {
    L.push(`| ${p} | ${r.status} | ${r.indexable ? 'yes' : 'noindex'} | ${r.title} (${(r.title || '').length}) | ${(r.description || '').length} | ${r.h1.length} | ${r.words} | ${report.linkGraph[p].inlinks} | ${r.types.join(', ')} | ${r.issues.length} |`);
  }
  L.push('', '## Private pages (must be noindex)', '', ...Object.entries(report.private).map(([p, r]) => `- ${r.ok ? '✅' : '❌'} ${p} — ${r.status}, meta robots: ${r.robots}, X-Robots-Tag: ${r.xRobots}`));
  if (Object.keys(report.lighthouse).length) {
    L.push('', '## Lighthouse (mobile)', '', '| Page | Perf | A11y | BP | SEO | LCP | CLS | TBT | Failed SEO audits | Top opportunities |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const [p, r] of Object.entries(report.lighthouse)) L.push(r.error ? `| ${p} | error | | | | | | | | ${r.error} |` : `| ${p} | ${r.perf} | ${r.a11y} | ${r.bp} | ${r.seo} | ${r.lcp} | ${r.cls} | ${r.tbt} | ${r.failedSeo.join(', ')} | ${r.topOpportunities.join('; ')} |`);
  }
  L.push('', '## Issues per page', '');
  for (const [p, r] of Object.entries(report.pages)) {
    if (!r.issues.length) continue;
    L.push(`### ${p}`, ...r.issues.sort((a, b) => order[a.sev] - order[b.sev]).map((i) => `- **${i.sev}** ${i.rule}${i.detail ? ` — ${i.detail}` : ''}`), '');
    L.push('Outline: ' + r.outline.join(' · '), '');
  }
  L.push('## robots.txt', '', '```', report.robotsTxt.trim(), '```');
  fs.writeFileSync(path.join(OUT, 'seo-audit.md'), L.join('\n'));
  console.log(`\nWrote ${OUT}/seo-audit.md and seo-audit.json (${Object.keys(report.pages).length} pages).`);
})().catch((e) => { console.error(e); process.exit(1); });
