# Kindly — Blog Foundation Decision (Alpha v0.1, Day 6-7)

**Decision:** Defer the blog authoring pipeline. Ship a real "coming soon" page
with email capture instead of a CMS/MDX build-out.

## Why defer

- No content exists yet — zero posts drafted, no editorial owner assigned.
  Building an authoring pipeline (MDX, headless CMS, or a `posts` DB table +
  admin editor) before there's anything to publish is pure speculative work.
- `/blog` is already in `sitemap.ts` and gets indexed; a placeholder scaffold
  page hurt SEO more than a warm, real "coming soon" page would (thin/duplicate
  content signals, no reason for Google to revisit the URL).
- None of the current dependencies (`package.json`) include an MDX/content
  toolchain, so any "build" option today means picking and wiring a new
  dependency under time pressure, for content that isn't ready anyway.

## What shipped instead

`/blog` ([src/app/(public)/blog/page.tsx](../src/app/(public)/blog/page.tsx))
now has real copy (see `BLOG` in `src/lib/content.ts`) describing what the blog
will cover, plus the existing `WaitlistForm` (parameterized with a `sourcePage`
prop) so interested readers can leave an email and get notified at launch. No
placeholder-scaffold language remains.

## Trigger to revisit

Build the real thing once there's:
1. An editorial owner and at least 3-5 drafted posts ready to publish, and
2. A rough cadence (e.g. weekly/biweekly) to justify a maintained pipeline.

At that point, the lightest option is Next.js + MDX files under
`src/app/(public)/blog/[slug]/page.tsx` (no external CMS dependency, keeps
posts in git, gets `buildMetadata`/JSON-LD for free) — a headless CMS is only
worth it once non-engineers need to publish without a PR.
