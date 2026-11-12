# SEO audit (automated)

Base http://localhost:3000 · site URL in sitemap http://localhost:3000 · 2026-11-12T18:28:50.260Z

## Site-wide

- **MEDIUM** robots.txt does not disallow /app/
- **MEDIUM** robots.txt does not disallow /admin
- **MEDIUM** content gap: no page targets "lonely aging parent"
- **MEDIUM** content gap: no page targets "AI companion for elderly"
- **MEDIUM** content gap: no page targets "family updates for aging parents"
- **MEDIUM** content gap: no page targets "senior living resident engagement software"
- **MEDIUM** content gap: no page targets "care home family engagement platform"
- **MEDIUM** no blog articles published (blog index stays noindex until 3+)
- **LOW** every sitemap lastmod is identical — 2026-11-02
- **INFO** /pricing/ → 308 /pricing — redirect to /pricing
- **INFO** /Pricing → 404 — 404 or redirect
- **INFO** /pricing?utm_source=x → 200 — canonical without query

## Pages

| Page | Status | Index | Title (len) | Desc len | H1 | Words | In-links | JSON-LD | Issues |
|---|---|---|---|---|---|---|---|---|---|
| / | 200 | yes | AI Companion for Aging Parents | Dearly (39) | 155 | 1 | 568 | 12 | Organization, WebSite | 2 |
| /how-it-works | 200 | yes | How Dearly Works: An AI Companion for Seniors (45) | 149 | 1 | 489 | 9 |  | 3 |
| /gift-for-aging-parent | 200 | yes | A Gift for Elderly Parents: Someone to Talk To | Dearly (55) | 150 | 1 | 321 | 9 |  | 3 |
| /pricing | 200 | yes | Senior Companion App Pricing: 7-Day Free Trial | Dearly (55) | 153 | 1 | 357 | 9 | Product, FAQPage | 3 |
| /trust-and-privacy | 200 | yes | AI Companion Privacy & Safety for Seniors | Dearly (50) | 149 | 1 | 594 | 9 |  | 3 |
| /senior-living | 200 | yes | AI Companion for Senior Living Communities | Dearly (51) | 151 | 1 | 466 | 9 |  | 3 |
| /waitlist | 200 | noindex | Email Updates | Dearly (22) | 148 | 1 | 101 | 9 |  | 0 |
| /blog | 200 | noindex | Blog: Caring for Aging Parents | Dearly (39) | 129 | 1 | 115 | 9 |  | 0 |
| /privacy | 200 | noindex | Privacy Policy (Draft) | Dearly (31) | 142 | 1 | 1132 | 10 |  | 0 |
| /terms | 200 | noindex | Terms of Use (Draft) | Dearly (29) | 153 | 1 | 551 | 10 |  | 0 |
| /login | 200 | noindex | Sign in — Dearly (16) | 114 | 1 | 20 | 12 |  | 0 |
| /signup | 200 | noindex | Create account — Dearly (23) | 114 | 1 | 46 | 11 |  | 0 |
| /login/forgot | 200 | noindex | Reset your password — Dearly (28) | 114 | 1 | 25 | 1 |  | 0 |

## Private pages (must be noindex)

- ✅ /login — 200, meta robots: noindex, nofollow, X-Robots-Tag: null
- ✅ /signup — 200, meta robots: noindex, nofollow, X-Robots-Tag: null
- ✅ /login/forgot — 200, meta robots: noindex, nofollow, X-Robots-Tag: null
- ✅ /login/reset — 200, meta robots: noindex, nofollow, X-Robots-Tag: null
- ✅ /login/verify — 200, meta robots: noindex, nofollow, X-Robots-Tag: null
- ✅ /invite/accept — 200, meta robots: noindex, nofollow, X-Robots-Tag: null
- ✅ /admin — 307, meta robots: null, X-Robots-Tag: noindex, nofollow
- ✅ /app/onboarding — 307, meta robots: null, X-Robots-Tag: noindex, nofollow
- ✅ /app/parent-profile — 307, meta robots: null, X-Robots-Tag: noindex, nofollow
- ✅ /app/memories — 307, meta robots: null, X-Robots-Tag: noindex, nofollow
- ✅ /app/family-summary — 307, meta robots: null, X-Robots-Tag: noindex, nofollow
- ✅ /app/referrals — 307, meta robots: null, X-Robots-Tag: noindex, nofollow
- ✅ /app/account — 307, meta robots: null, X-Robots-Tag: noindex, nofollow
- ✅ /app/talk — 200, meta robots: noindex, nofollow, X-Robots-Tag: noindex, nofollow

## Lighthouse (mobile)

| Page | Perf | A11y | BP | SEO | LCP | CLS | TBT | Failed SEO audits | Top opportunities |
|---|---|---|---|---|---|---|---|---|---|
| / | 96 | 100 | 96 | 100 | 2.7 s | 0 | 80 ms |  | Eliminate render-blocking resources (Est savings of 590 ms); Reduce unused JavaScript (Est savings of 64 KiB) |
| /how-it-works | 97 | 100 | 96 | 100 | 2.4 s | 0 | 120 ms |  | Eliminate render-blocking resources (Est savings of 730 ms); Reduce unused JavaScript (Est savings of 64 KiB) |
| /gift-for-aging-parent | 95 | 100 | 96 | 100 | 2.8 s | 0 | 100 ms |  | Eliminate render-blocking resources (Est savings of 740 ms); Reduce unused JavaScript (Est savings of 64 KiB) |
| /pricing | 97 | 100 | 96 | 100 | 2.4 s | 0 | 90 ms |  | Eliminate render-blocking resources (Est savings of 770 ms); Reduce unused JavaScript (Est savings of 64 KiB) |
| /trust-and-privacy | 96 | 100 | 96 | 100 | 2.7 s | 0 | 70 ms |  | Eliminate render-blocking resources (Est savings of 750 ms); Reduce unused JavaScript (Est savings of 64 KiB) |
| /senior-living | 97 | 100 | 96 | 100 | 2.5 s | 0 | 80 ms |  | Eliminate render-blocking resources (Est savings of 750 ms); Reduce unused JavaScript (Est savings of 64 KiB) |
| /blog | 92 | 100 | 96 | 66 | 2.6 s | 0 | 240 ms | is-crawlable | Eliminate render-blocking resources (Est savings of 770 ms); Reduce unused JavaScript (Est savings of 64 KiB) |

## Issues per page

### /
- **LOW** same og:image on every page (no page-specific share image)
- **LOW** Organization has no sameAs (social profiles)

Outline: H1: AI companion for aging parents — For the moments you can’t be there · H2: You can’t call every day. That’s okay. · H2: A familiar voice, whenever they want to talk · H2: How Dearly works · H3: You set it up · H3: They simply talk · H3: You stay close · H2: Made for your parent, not just for you · H2: Private and safe, by design · H2: One simple plan for staying close · H2: Give your parent someone kind to talk to

### /how-it-works
- **LOW** same og:image on every page (no page-specific share image)
- **LOW** no structured data
- **LOW** no BreadcrumbList

Outline: H1: How Dearly works: an AI companion for seniors in three steps · H2: 1. You set up the gift · H2: 2. Your parent simply talks · H2: 3. You get a gentle weekly summary · H2: Built to be easy for a 78-year-old, not just for you · H2: What your family actually sees · H2: What Dearly is — and isn’t · H2: Ready to set it up?

### /gift-for-aging-parent
- **LOW** same og:image on every page (no page-specific share image)
- **LOW** no structured data
- **LOW** no BreadcrumbList

Outline: H1: A gift for elderly parents: someone kind to talk to · H2: A different kind of gift · H2: A thoughtful choice for any occasion · H2: For a parent who says “I don’t do computers” · H2: What’s inside the gift · H2: Give the gift of someone to talk to

### /pricing
- **MEDIUM** Product without image (required for merchant/product snippets)
- **LOW** same og:image on every page (no page-specific share image)
- **LOW** no BreadcrumbList

Outline: H1: Simple pricing for your parent’s senior companion app · H2: Family · H2: Questions about pricing · H2: Ready to give your parent someone kind to talk to?

### /trust-and-privacy
- **LOW** same og:image on every page (no page-specific share image)
- **LOW** no structured data
- **LOW** no BreadcrumbList

Outline: H1: Private and safe, by design · H2: Consent comes first · H2: We collect less, on purpose · H2: Dearly always says what it is · H2: Not a medical service · H2: How we handle a real concern · H2: You stay in control of the data · H2: Questions about privacy or safety?

### /senior-living
- **LOW** same og:image on every page (no page-specific share image)
- **LOW** no structured data
- **LOW** no BreadcrumbList

Outline: H1: An AI companion for senior living residents · H2: Your team can’t be everywhere either · H2: Built for residents, not just for families · H2: What it means for your community · H2: A companion, not a caregiver · H2: Request a demo · H2: Curious how Dearly could fit your community?

## robots.txt

```
User-Agent: *
Allow: /
Disallow: /api/

Sitemap: http://localhost:3000/sitemap.xml
```