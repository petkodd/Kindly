# Kindly — Alpha v0.1

> For the moments you can’t be there.

A warm, voice-first AI companion gift for aging parents. An adult child sets up a
companion for their parent, seeds it with memories, the parent talks with a kind
and patient AI, and the family receives a respectful weekly summary.

This repository is the **Alpha v0.1 scaffold**: a web-first, PWA-friendly
Next.js + TypeScript + Tailwind app with a marketing website (SEO-ready) and a
private web app shell (noindex). It builds offline and deploys to Vercel.

---

## What’s in the box

```
src/
  app/
    (public)/            Marketing site — indexable, SSR/SSG
      page.tsx           Home (full landing page, all sections + JSON-LD)
      gift-for-aging-parent/, how-it-works/, pricing/,
      trust-and-privacy/, senior-living/, blog/, waitlist/
      layout.tsx         Header + footer wrapper
    (app)/app/           Private web app — noindex
      onboarding/, parent-profile/, memories/, talk/,
      family-summary/, referrals/
    admin/               Internal dashboard (noindex)
    api/waitlist/        Working waitlist endpoint (DB-backed, degrades gracefully)
    sitemap.ts           Public pages only
    robots.ts            Disallows /app/, /admin, /api/
  components/            SiteHeader, SiteFooter, WaitlistForm
  lib/                   seo.ts (metadata helper), db.ts (pg pool), content.ts (copy)
db/
  migrations/0001_init.sql   Full schema v1 (15 tables, pgvector)
  migrate.mjs                Migration runner
docs/                    api_plan, analytics_events, prompt_architecture (from Cycle 2)
```

## Design system

Senior-first by default: large base type (≈19px), ≥48px touch targets, AA contrast,
always-visible focus rings, reduced-motion respected. Palette is a calm sage + warm
clay on a soft off-white — deliberately not a generic SaaS look. Tokens live in
`tailwind.config.ts` and `src/app/globals.css`.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL etc.
npm run dev                  # http://localhost:3000
```

The site runs without a database — the waitlist endpoint degrades gracefully when
`DATABASE_URL` is unset. To enable persistence:

```bash
# Postgres with the pgvector extension (Neon, Supabase, or RDS)
export DATABASE_URL=postgres://user:pass@host:5432/kindly
npm run db:migrate
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build (no network deps) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Apply `db/migrations/*.sql` |

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import into Vercel (framework auto-detected as Next.js).
3. Add env vars from `.env.example` (at minimum `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`).
4. Provision a Postgres add-on with pgvector and run `npm run db:migrate` once.
5. After first deploy, verify the domain in Google Search Console and submit `/sitemap.xml`.

`X-Robots-Tag: noindex, nofollow` is set on `/app/*` and `/admin` via both
`next.config.mjs` and `vercel.json`.

## Branch model

`main` (protected) ← `dev` (integration) ← `feature/*`. See `docs/` and the Cycle 1/2
planning artifacts for the full branch list, reviewers, and acceptance criteria.

## Safety & privacy (non-negotiable)

- Kindly always discloses it is an AI; never pretends to be human.
- Never replaces family, caregivers, doctors, or emergency services.
- No medical claims (no diagnose / treat / cure / prevent).
- Consent-gated activation; data minimization; per-parent isolation; hard-delete path.
- Crisis handling surfaces 988/911 and flags humans — never impersonates rescue.

See `docs/prompt_architecture_v1.md` for the enforced behavior rules and red-team suites.

---

Alpha v0.1 · web-first · no native mobile · SMS mocked · single Stripe checkout (planned).
