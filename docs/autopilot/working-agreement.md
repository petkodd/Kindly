# Dearly (repo: Kindly): working agreement for autopilot sessions

Adapted from the project's `claude/kindly-working-agreement.md` for cloud
sessions that run without Petko (decision D12). Where this differs from the
original, this file wins for autopilot runs.

## Context
- **Repo:** `petkodd/Kindly` on GitHub. Clone it in the session; there is no
  Mac and no `~/kindly-app`.
- **Stack:** Next.js 15 App Router, TypeScript and Tailwind; Postgres via raw
  `pg` (repos in `src/lib/repos`, migrations in `db/migrations`); Anthropic SDK
  (`src/lib/ai`); Deepgram (speech-to-text) and ElevenLabs (text-to-speech) in
  `src/lib/speech`; Resend email; Twilio SMS (fake until keys exist); Stripe;
  Sentry; Vercel (Hobby: crons must be daily) with crons in `vercel.json`;
  vitest with pg-mem.
- **Baseline:** on 2026-10-30 (`release/mvp-alpha` at `dd2a1bb`) 1050 tests
  pass and 15 are skipped. Keep everything green.
- **Brand:** D1 is decided: **Dearly**. Internal identifiers stay as they are.
- **pg-mem gaps** (tests): no `ALTER TYPE … ADD VALUE` (use TEXT + CHECK), FK
  default names differ (`_fk` vs Postgres `_fkey`; drop both), no correlated
  subqueries with an outer alias, no CITEXT case-folding, no real ROLLBACK.
  Every new migration must also be applied on the real local Postgres.

## Setup (every session)
```bash
git clone https://github.com/petkodd/kindly ~/kindly && cd ~/kindly   # or reuse
git fetch origin release/mvp-alpha
npm ci
DB=$(bash scripts/autopilot/setup-local-db.sh)   # local only, prints the URL
```
Create `.env.local` from `.env.example` with `DATABASE_URL=$DB`, generated
`SESSION_SECRET` / `CRON_SECRET` (`openssl rand -hex 32`), `DEMO_MODE=true`,
`DEMO_PASSWORD=demo-pass-123`. Leave every paid key empty (fake clients).
Git identity: `Claude <noreply@anthropic.com>`.

## Rules
- **Only the local DB.** Never use a database URL from anywhere else.
- **No live keys.** Stripe test mode only, mocked in tests. Never print secret
  values (env var names only).
- Never push to `main`, never open PRs against `main`, never deploy, never run
  production migrations. PRs go into `release/mvp-alpha`.
- Stay in scope. Out-of-scope findings go under "Follow-ups". Respect the
  ownership map below.
- Every behaviour change needs tests.
- Before handing over: `npm run typecheck && npm run lint && npm test` green
  and `npm run build` passes.
- UI work: run the production build against the local DB and check it in
  headless Chromium (Playwright is pre-installed) at 375, 768 and 1280 widths.
  Commit screenshots under `docs/autopilot/evidence/chat-NN/`.
- **Prompt changes:** never edit a signed prompt in place; add a new `_Vn`
  constant and switch callers. Run `npm run check:prompt-signoffs` and report
  the result. **Never sign** (`scripts/sign-prompt.mjs`) — that is for the
  named human reviewers.
- Small conventional commits. End each commit message with
  `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Push WIP to the chat branch at least hourly (see README) so work survives a
  session ending.

## File ownership (later chats may touch an area after its owner merged)
| Area | Owner chat |
|---|---|
| prompts, `anthropic.ts`, talk routes, safety flags | 3 (merged) → 9, 13 may touch |
| memories repo/routes, `sessionEnd.ts` | 4 (merged) → 9, 12 |
| rate limiter, conversation history, usage/cost | 5 (merged) |
| purge, delete paths, billing webhook, crons, summary send | 6 (merged) → 9 |
| `api/auth/*`, `session.ts`, `src/app/login`, `src/app/signup` (except the referral field) | 7 (merged) → 10, 11 |
| talk screen, `src/lib/speech/*`, CSP | 8 (merged) → 9 |
| `src/middleware.ts`, onboarding, account, parent-profile link section, `SiteHeader` | 10 → 12 |
| `tailwind.config.ts`, `globals.css`, `formStyles.ts`, shared components | 12 → 13 |
| `src/lib/content.ts`, public pages, `seo.ts`, `sitemap.ts` | 13 |

## Known state after chats 1–8 (useful context)
- Auth (chat 7): signup returns `202 {next:'check_email'}` with no cookie;
  email verification gates sibling invites and summary sending
  (`userRepo.requireVerifiedEmail`, 403 `email_unverified`); `/login/forgot`,
  `/login/reset`; logout revokes all sessions via `users.sessions_valid_from`;
  every state-changing `/api` route rejects cross-origin writes
  (`rejectCrossOrigin`, or inside `resolveBuyer/resolveAdmin/resolveParentFromRequest`).
  A sweep test (`test/routes/originGuard.route.test.ts`) fails if a new write
  route lacks the guard — new routes must use those helpers.
- Rate limits: `rateLimitRepo.enforce(q, key, {limit, windowMs, message})`.
- Crons (Vercel Hobby): daily only; a test enforces it.
- `npm run check:prompt-signoffs` already fails on `main`: human sign-offs
  pending. Expected.

## PR body template
```
Goal / Scope
Changes (files)
Test notes (commands run + results, screenshots for UI)
Acceptance criteria (checklist, each ticked or explained)
Required reviewers (from the chat prompt) — and, after review, one line per role
Privacy & safety notes (data, AI memory, summaries, conversations)
SEO notes (public pages only)
Decisions used (D-numbers, and whether a default was assumed)
Follow-ups (out of scope items found)
Tracking: #<issue>
```
