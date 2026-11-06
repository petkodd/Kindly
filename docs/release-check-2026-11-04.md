# Release check — `release/mvp-alpha` @ `41e9e1a` (2026-11-04)

Chat 14: an independent verification of chats 1–13 before the private alpha. This is a read-only review. The only changes are this report and the screenshots in `docs/autopilot/evidence/chat-14/`.

## Verdict: **NO-GO to merge into `main` today. GO for the private alpha once the 5 blockers below are closed.**

The product works end to end on a fresh clone.
- Every flow walked passes, and IDOR isolation holds on every route.
- The safety pipeline is wired for voice and text.
- axe finds 0 serious or critical issues. Lighthouse scores accessibility 100 and SEO 100 on every indexed page.
- 9 of the 13 audit CRITICAL/HIGH items are FIXED and 4 are PARTIAL. None is still OPEN.

What blocks the merge:

| # | Blocker | Who |
|---|---|---|
| B1 | **CI is red on `release/mvp-alpha`.** `test/seed.test.ts` has a real-clock time bomb (NEW-1) that started failing on 2026-11-04 at 15:00Z. | developer: 1 small test fix |
| B2 | **All 4 serving prompts are unsigned** by any of the 3 required roles. | Petko + human reviewers (never AI) |
| B3 | **When a turn is refused or fails, a crisis message gets no 988/911 help** (NEW-2). | developer |
| B4 | **Family crisis alerts are not durable.** A failed send uses up the 30-minute throttle, so later P0/P1s are dropped, with no retry and no admin backup (NEW-3). The wording "I'm going to let Sarah know" is shown even when no one is told (NEW-6). | developer |
| B5 | **The home-page mobile menu opens invisibly** below 1024px and its links can't be tapped (NEW-4). | developer: 1 class |

B1, B3, B4 and B5 are small and well-scoped. Together they fit in one developer chat (suggested name: chat 15, "release fixes"). B2 is human-only.

## Minutes to first demo

About **3 minutes** from `git clone` to a seeded app with logins and a talk link. That breaks down as clone ~5 s, `npm ci` 27 s, local DB 1 s, `db:seed` 1 s, and `npm run build` + `next start` ~95 s. `npm run dev` would be faster.

Friction:
1. **Docker was unavailable** in this environment, so I used `scripts/autopilot/setup-local-db.sh` instead of `docker compose`. The README Docker path was not exercised.
2. **pgvector was missing** from the preinstalled Postgres 16. The script found `pg_ctl` and skipped its own install, and `CREATE EXTENSION vector` then failed. Fix: in `setup-local-db.sh`, also check for `/usr/share/postgresql/16/extension/vector.control` and install `postgresql-16-pgvector` if it is absent.
3. The README never says to set `DEMO_MODE=true`. It isn't required, because the badge shows anyway when keys are empty, but the autopilot working agreement asks for it.
4. **Beta activation needs `FOUNDING_FAMILY_BETA_ENABLED=true`** and an invite made with `scripts/beta-invite.mjs`. Neither is in the quick start, so a demo user hits "Billing is not configured yet." at the billing step.
5. **The seeded summary preview is empty** (NEW-11). The seed writes the current week, but preview and send use the last full week (D5).

## Checks run

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ pass |
| `npm run lint` | ✅ pass (1 warning: custom font in `_document`) |
| `npm test` | ❌ **1 failed** / 1334 passed / 15 skipped. The failure is `seed.test.ts` "creates the full demo dataset" (NEW-1). The same failure is in CI `build` on `41e9e1a`. Re-run with the clock shifted +60 d and +420 d: no other time bombs. |
| `npm run build` | ✅ pass |
| `npm audit --omit=dev` | ✅ 0 critical, 0 high, 6 moderate (Sentry chain: glob/minimatch, fast-uri); `next@15.5.28` |
| `npm run check:prompt-signoffs` | ❌ expected FAIL: 10 prompt keys, 0 sign-offs (see Sign-off status below) |
| Migrations on a fresh local Postgres 16 + pgvector | ✅ 0001–0021 applied, seed OK |
| axe (`npm run test:a11y`) | ✅ 0 serious/critical on home, pricing, signup, onboarding, parent-profile, memories, family-summary, referrals, account and talk, at 375 and 1280 (`evidence/chat-14/axe-report.json`). The final consent-notice step timed out because the demo parent had already consented during testing. That's test data, not a defect; chat 12/13 evidence covers it. |
| Lighthouse (perf / a11y / best-practices / SEO) | `/` 88/100/96/100 · `/pricing` 89/100/96/100 · `/how-it-works` 88/100/96/100 · `/gift-for-aging-parent` 88/100/96/100 · `/trust-and-privacy` 92/100/96/100 · `/senior-living` 83/100/96/100 · `/waitlist` 88/100/96/100 · `/privacy` 93/100/96/100 · `/terms` 92/100/96/100 · `/blog` 89/100/96/**66** (only `is-crawlable`: intentionally noindex, correct). The best-practices miss is console errors: a blocked external request (sandbox proxy) and a 401 from a signed-out `/api/me` probe (NEW-17). Performance is limited by LCP ~3.0 s on a local `next start`. |

## Audit re-check (2026-10-19 CRITICAL/HIGH)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Voice output filter | **FIXED** | `src/lib/ai/turn.ts:85-189` runs scan → reply → filter (1 regeneration, then fallback) → crisis prefix, plus a redaction audit_log row. Called from `api/talk/message/route.ts:59` and `api/talk/voice/route.ts:179`. Tests: `test/routes/voice.route.test.ts` (cases 1, 13, 14) and `test/turn.test.ts`. Live: a voice turn returns 200 through the same pipeline. |
| 2 | Crisis alerting (D2) | **PARTIAL** | Done: buyer email + SMS (only with a phone and consent), 30-minute throttle, P3 to admin only, Sentry fatal + audit_log, per-channel status shown in admin (`src/lib/safety/alerts.ts:118-217`, `AdminDashboard.tsx:51-56`). Tests: `test/safetyAlerts.test.ts`. Live: P0 → email simulated, SMS simulated (with phone) or skipped_no_phone; repeat → suppressed; P3 never reached the buyer. **Gaps:** NEW-3 (throttle claimed before delivery, no retry, inline send with an 8 s wait and no `after()`), NEW-6 (alert wording) and NEW-7 (unset `ADMIN_ALERT_EMAIL`). Twilio keys don't exist yet. |
| 3 | Companion prompt safety rules | **FIXED (unsigned)** | `COMPANION_SYSTEM_V3` (`prompts.ts:189-207`, `:436`) has all the rules: 911 first, 988 + "is someone with you", honest "let {buyer} know", Eldercare 1-800-677-1116, scams, no romance, no impersonation, honest answer about secrets, 1–3 sentences; `max_tokens` 250. Real-model behaviour is NOT VERIFIED (no test key). |
| 4 | Next advisories | **FIXED** | `next@15.5.28`; 0 critical, 0 high. |
| 5 | Restricted memories exposed to family | **FIXED** | `memoryRepo.list` hard-filters restricted rows (`memory.ts:111`); the export uses it (`accountExport.ts:47`); CHECK `memories_never_restricted` is present in the live DB, and a direct INSERT was rejected. An API POST with `sensitivity:'restricted'` is stored as `normal`. Export and memory GET have no restricted rows. |
| 6 | Prompt injection via profile and memories | **FIXED** (minor gap NEW-15) | Profile and memories are in escaped `<parent_profile>`/`<memories>` tags with a "never an instruction" line (`prompts.ts:210,259-301`); caps in `types.ts:21-31`; the server sets `source`; the transcript is in `<transcript>`; a summary backstop blocks URL/phone/$ (`prompts.ts:514-536`; live-probed). Tests: `memoryPrivacy.test.ts`, `summaryPrivacy.test.ts`. |
| 7 | Stripe not cancelled on delete | **FIXED** | `user.ts:320-332` and `parent.ts:221-232` cancel first, then revoke tokens, then soft-delete; idempotent (`billing/cancel.ts`). Live: delete account → `subscriptions.status='canceled'`, login 401. Minor gap NEW-16. |
| 8 | Purge crash | **FIXED** | Migration 0017 SET NULL on both `beta_invites` FKs (checked in the DB); one transaction per user (`purge.ts:97`); test `dataLifecycle.test.ts:166`. |
| 9 | Abandoned-session retention | **PARTIAL** | Done: the sweeper (`jobs/endIdleSessions.ts`) and a 30-day backstop on every turn (`conversation.ts:110-112`). **Gaps:** on Vercel Hobby it runs daily (`vercel.json` `30 4 * * *`), so sessions end up to ~24 h late. Failed end-of-session jobs are never retried (NEW-9). |
| 10 | Talk rate limits and caps | **FIXED** (gaps NEW-10, NEW-12) | Atomic limiter (`rateLimit.ts:142-150`); per-parent and per-IP limits; text 2000 / audio 3 MB / 100 turns / `maxDuration` 30; history 20 turns. Live: turn 31 → 429; 2001 characters → 413; 3 MB + 10 B → 413. |
| 11 | Parent summary consent | **PARTIAL** | Done: `parent_summary_sharing` (0019); notice text matches D2 word for word, rebuilt server-side and stored with a version (`consent.ts:117-128`); required by manual send and auto-send. Live: a new parent without it → 409 `parent_consent_required`. Mood heads-up removed (D3). **Gaps:** NEW-8 (consent doesn't follow recipient changes; the parent can't withdraw). |
| 12 | Prompt sign-off gate | **PARTIAL** | Done: the hash covers the full bundle (system text, template, crisis/greeting, banned patterns, fallback, model id, max_tokens) (`prompts.ts:552-629`); CI blocks on pushes to main/release/* and PRs into release/*. **Gap:** NEW-5 (nothing stops an unsigned prompt from deploying). |
| 13 | Scan context | **FIXED** | Last 6 turns in `<conversation>` + `<message>`; older-adult ideation and stroke examples; `AI_SAFETY_MODEL` (default `claude-haiku-4-5`), max_tokens 150 (`prompts.ts:181,373-395`, `anthropic.ts:45,149-165`). |

## Sign-off status (NO-GO item for Petko)

`npm run check:prompt-signoffs`: **no prompt has any sign-off.**

| Prompt | Serving? | AI Safety | Gerontology | Privacy |
|---|---|---|---|---|
| `COMPANION_SYSTEM_V3` (includes the V2 safety text) | **yes** (`anthropic.ts:143`) | ✗ | ✗ | ✗ |
| `SAFETY_SCAN_SYSTEM_V2` | **yes** (`anthropic.ts:152`) | ✗ | ✗ | ✗ |
| `MEMORY_EXTRACTION_SYSTEM_V3` | **yes** (`anthropic.ts:173`) | ✗ | ✗ | ✗ |
| `CONVERSATION_SUMMARY_SYSTEM_V2` | **yes** (`anthropic.ts:20`) | ✗ | ✗ | ✗ |
| `COMPANION_SYSTEM_V1/V2`, `SAFETY_SCAN_SYSTEM_V1`, `MEMORY_EXTRACTION_SYSTEM_V1/V2`, `CONVERSATION_SUMMARY_SYSTEM_V1` | historical | ✗ | ✗ | ✗ |

The gate also requires sign-off on the 6 historical keys. Suggestion (NEW-5): limit it to serving prompts so reviewers only sign what ships.

## Flow results (headless Chromium, 1280 / 768 / 375)

Screenshots in `docs/autopilot/evidence/chat-14/` are a representative subset of the 116 captured.

| Flow | Result | Notes / evidence |
|---|---|---|
| Visitor → pricing → waitlist | ✅ | 7-day trial shown on the card; empty and invalid email errors with `aria-invalid`; success view. `A-p1-pricing-*`, `A-p1-waitlist-success-1280` |
| Facility demo form | ✅ | Errors on each field, focus moves to the first; `/api/demo` 201. `A-p1-demo-invalid-1280` |
| Mobile menu < 1024px | ❌ **home only** | Invisible and covered by the hero on `/` (NEW-4); fine on the 7 other public pages. `A-p1-mobilemenu-open-375` vs `A-p1-mobilemenu-pricing-375` |
| Signed-out redirects | ✅ | `/app/account` → `/signup?next=…`; `/admin` → `/login?next=/admin` |
| Signup → verify | ✅ / ⚠️ | Signup 202 "check your email". The verify link could not be read from the fake email (subject only), so I set `email_verified_at` locally. A second run reached `/login/verify` by swapping a known token into `magic_link_tokens`: PASS. |
| Onboarding → beta | ✅ | All 7 steps, with errors on empty name and unticked consent. Billing step without Stripe → "Billing is not configured yet." (expected). Beta activation tested with `FOUNDING_FAMILY_BETA_ENABLED=true` and a CLI invite: 200. `A-p2-10-ob-beta` |
| Emergency alerts step | ✅ / ⚠️ | E.164 validation, SMS box unticked by default with STOP wording. NEW-13: a phone with the box unticked moves on silently. `A-p2-11-ob-alerts` |
| Talk link → revoke → re-issue | ✅ | Old link → friendly "ask your family…"; new link works; DB has 1 active token. `A-p2-16/17`, `A-p3-01-old-link` |
| Parent talk: consent notice | ✅ | D2 sentence shown with Yes / Not now; not asked again after Yes. `A-p3-05-notice` |
| Parent talk: voice (fake media), text, end, talk again | ✅ | `/api/talk/voice` 200; "Type instead" after mic denied → text 200; "I'm done for now" → "Take care" → "Talk again". No buyer nav; "AI companion" badge. `A-p3-*` |
| Memories: add, edit, delete, over-length | ✅ | 300-character cap in the UI and API (400); edit 200; delete 204 with a confirm. |
| Restricted memories never visible | ✅ | DB CHECK rejects them; API coerces to `normal`; no restricted rows in GET or export. |
| Summary: preview, send (simulated), auto-send | ✅ | Delivery `simulated`; 409 without parent consent; auto-send toggle; past weeks expand. Demo preview is empty (NEW-11). |
| Referral: ?ref → signup → pending | ✅ | Cookie set, code prefilled, redeemed after verify; referrer sees "Pending". |
| Referral: paid invoice → credits | ⚠️ NOT VERIFIED in the browser | Webhook needs `STRIPE_WEBHOOK_SECRET`. Covered by `test/routes/referralCredit.route.test.ts` and `test/referral.test.ts` (credit, $0 trial skipped, dedupe, retry, yearly 1/12). |
| Logout | ✅ | Replaying the old cookie → 401. |
| Forgot / reset password | ✅ | Generic message; reset revokes all sessions; reusing the token → 404. |
| Export | ✅ | No hashes, Stripe ids or restricted rows; a second export within an hour → 429. |
| Delete account | ✅ | Confirmation lists everything + "subscription canceled"; `subscriptions.status='canceled'`; login 401. `B-acct-delete-confirm-375` |
| Admin | ✅ / ⚠️ | Flags list shows notified_at and per-channel status; cost per active user $0.07 and per voice minute $0.02 match `usage_costs`. Non-admin blocked. 375 px overflow (NEW-14). |
| IDOR (second organizer) | ✅ | All 17 `/api/parents/[id]/*` endpoints, `/api/memories/[mid]` (PATCH confirm/edit/retire, DELETE), `/api/consent/[cid]/revoke`, admin flag PATCH and the talk routes with another parent's conversation_id → 404/401; no leaks; DB unchanged before/after. Cross-origin writes → 401. Malformed UUID → 500 (NEW-18). |
| Safety red-team (fake client) | ✅ wiring / ⚠️ model | Cases 1–5 and 8 produce the right flag + deterministic 911/988/Eldercare/scam prefix; one alert per 30 minutes; P3 never to the buyer; cases 6, 7, 9, 10, 11 and 12 can't be expressed by the fake. The fake STT has a fixed transcript, so the voice crisis cases are NOT VERIFIED. Live red-team needs a test-only key. |

## New findings

### HIGH

**NEW-1 (HIGH, CI): `test/seed.test.ts:81,150-151` is a time bomb that makes CI red.**
- What happens: the test seeds with a fixed `NOW = 2026-10-21T15:00Z` and a 14-day beta (`db/seed-lib.mjs:254`). `conversationRepo.openSession` → `assertCanTalk` → `subscriptionRepo.isBillingCurrent(q, parentId)` (`src/lib/repos/conversation.ts:66`) then checks against the real clock. It has failed since 2026-11-04 15:00Z, both locally and in CI `build` on `41e9e1a`.
- Fix: use `vi.useFakeTimers({ now: NOW, toFake: ['Date'] })` in that test, or have the test seed with `now: new Date()` and assert the week relative to it.

**NEW-2 (HIGH, safety): when a turn is refused or fails, a crisis message gets no help and no flag.**
- Refusals before the scan: the rate limit and the 2000-character cap run first (`src/app/api/talk/message/route.ts:32,39`, `src/app/api/talk/voice/route.ts:47`). Live: while rate-limited, "I want to kill myself" got 429 "Let's take a short break…", with no flag, no alert and no 988.
- Failures after the scan: if the reply fails, `turn.ts:134-141` re-throws even for P0/P1/P3 (locked in by `test/turn.test.ts:135`). A TTS failure after the reply (`voice/route.ts:192`) loses the crisis text.
- Fix, in three parts:
  - Run a cheap deterministic crisis keyword check before every refusal. On a match, record the flag, dispatch the alert and return `crisisResourceV2` copy.
  - On a reply failure with a P0/P1/P3 scan, return the crisis prefix + `SAFE_FALLBACK_REPLY`.
  - On a TTS failure, return the text reply with `tts_url: null`. Also add "If this is an emergency, call 911, or call or text 988" to every non-retryable message in `src/lib/talk/errors.ts`.

**NEW-3 (HIGH, safety): family crisis alerts are not durable.**
- `src/lib/safety/alerts.ts:136` claims the 30-minute slot **before** sending. A failed or undelivered first alert therefore suppresses every later P0/P1 for that parent, and the throttled path sends no admin backup.
- Live: chest pain after an undelivered P0 → `suppressed_rate_limit`, while the admin UI said "already alerted" and "family not notified" at the same time.
- Sending is inline with an 8 s wait (`turn.ts:37,186`) and no `after()`/`waitUntil`, so on serverless it can be frozen. There's no retry job, and the email fetch has no timeout (`src/lib/email/providers.ts:45`).
- Fix:
  - Claim the slot only after a `sent` delivery, or release it on failure.
  - Always send the admin backup when throttled after an undelivered alert.
  - Dispatch through `after()`.
  - Add a retry cron for P0/P1 with `notified_at IS NULL AND NOT throttled`.
  - Add `AbortSignal.timeout(10_000)` to the email fetch.

**NEW-4 (HIGH, UX/conversion): the home-page mobile menu can't be used below 1024px.**
- `src/components/SiteHeader.tsx:17`: the header has `relative backdrop-blur` and no z-index. The blur creates its own layer, so `MobileMenu.tsx:77` `z-50` only counts inside the header, and the `relative` hero sections (`src/app/(public)/page.tsx:49,54`) paint over the panel. The button reads "Close" but no menu is visible, and the links can't be tapped.
- Fix: add `z-40` to the `<header>`. Add a Playwright check that a menu link on `/` receives the click.

**NEW-5 (HIGH, governance): nothing stops unsigned prompts reaching production.**
- The sign-off job blocks pushes to main/release/* but not deploys. Vercel deploys `main` on every push regardless of CI (`vercel.json` git.deploymentEnabled). `migrate` doesn't depend on `prompt-signoffs`. CODEOWNERS covers only `prompts/signoffs.json`, with placeholder handles. `AI_MODEL`/`AI_SAFETY_MODEL` overrides only log a warning (`src/lib/ai/anthropic.ts:44-54`).
- Fix:
  - Add a Vercel Ignored Build Step that runs `npm run check:prompt-signoffs` on production, or deploy from CI after the required checks.
  - Make the job required on PRs into main.
  - Limit the gate to serving prompts.
  - Put real CODEOWNERS on `src/lib/ai/**`, `prompts/**` and `.github/workflows/**`.
  - Refuse an unsigned model override in production.

### MEDIUM

**NEW-6 (MEDIUM, honesty/D2): the reply says "I'm going to let Sarah know" even when nobody is told** (throttled, failed or simulated).
- `src/lib/ai/turn.ts:180` builds the prefix from whether a contact exists; the outcome is only awaited at `:186`.
- Fix: build the clause from the alert outcome, and drop it when nothing was sent.

**NEW-7 (MEDIUM, safety ops): if `ADMIN_ALERT_EMAIL` is unset in production, P3 (abuse/scam) alerts reach nobody.**
- `alerts.ts` returns `not_configured`, and there is no production assertion (`src/lib/runtimeMode.ts`).
- Fix: fail the boot or health check in production, like `MissingProviderKeyError`.

**NEW-8 (MEDIUM, privacy): parent summary consent is static.**
- The consent names the recipients at the time it is given. Recipients added later get summaries under the old consent (`src/lib/repos/summary.ts:298-305`, `summaryNotice.ts:76`).
- After "Yes", the parent has no way to withdraw (`consent.ts:124-145`).
- Fix: store the recipient set in `consents.detail` and ask again when it changes. Add a "stop weekly notes" control on the talk screen.

**NEW-9 (MEDIUM, data): failed end-of-session jobs are never retried.**
- `src/lib/jobs/endIdleSessions.ts:42` only selects `ended_at IS NULL`.
- Fix: also pick up ended conversations where `summary_text IS NULL OR memories_extracted_at IS NULL`, with an attempt cap.

**NEW-10 (MEDIUM, cost): the daily voice-minute cap can be bypassed.**
- It reads `usage_costs` (`src/lib/talk/limits.ts:68-83`), but the voice route swallows failures writing that row (`voice/route.ts:204-216`), and the check is check-then-act.
- Fix: cap on `conversations.voice_minutes`, or use an atomic counter.

**NEW-11 (MEDIUM, demo): the seeded summary preview is empty.**
- `db/seed-lib.mjs:288` seeds the current ISO week, but preview and send use the last full week (D5), so the founder demo shows "We didn't hear from Mom (demo) this week".
- Fix: seed the previous week.

**NEW-12 (MEDIUM, B2B): the per-IP talk limit will block a facility pilot.**
- 30 turns per 10 minutes and 300 per day per IP (`limits.ts:27-28`), against 25–50 residents on one IP.
- Fix: a facility allowlist, or a per-facility key, before any B2B pilot.

**NEW-13 (MEDIUM, D2): an alert phone with the SMS box unticked moves on silently.**
- `src/components/AlertContactForm.tsx:55-59` stores the phone without consent, and `onboarding/page.tsx:765` advances before the "email only" notice is shown. The buyer may think texts are on.
- Fix: block with "Tick the box to get text alerts, or clear the number", and don't store the phone without consent.

**NEW-19 (MEDIUM, auth UX): a revoked session sends existing users to sign-up.**
- The cookie is still signed, so `/login` redirects to onboarding (`src/middleware.ts:49`). Onboarding's 401 handler then goes to `/signup` (`src/app/(app)/app/onboarding/page.tsx:37`).
- Fix: use `/login` in that handler.

### LOW
- **NEW-14:** admin flag actions overflow at 375 px (`src/app/admin/AdminDashboard.tsx:188`, `shrink-0`). Fix: add `min-w-0 w-full sm:w-auto`.
- **NEW-15:** the tag-strip regexes miss `< /message>` and `< /transcript>` (`prompts.ts:389,502`). Fix: escape `<`/`>` as `escapeContextText` does.
- **NEW-16:** `incomplete` subscriptions are not cancelled on delete (`src/lib/billing/cancel.ts:30`).
- **NEW-17:** public pages log a 401 console error from a signed-out session probe, which costs Lighthouse best-practices points. Fix: make the probe return 200 `{user:null}`, or skip it.
- **NEW-18:** a malformed UUID in any `[id]`/`[mid]`/`[cid]`/`conversation_id` → 500 (Postgres uuid syntax error). Fix: validate and return 404.
- **NEW-20:** per-IP limits trust a client-supplied `X-Forwarded-For` (`src/lib/auth.ts:31`). This is safe only behind Vercel. Fix: use `x-real-ip` / `x-vercel-forwarded-for`.
- **NEW-21:** backstop gaps. `applyBannedOutputFilter` doesn't catch medication advice, a deceased-spouse persona, "bank PIN" or wire encouragement. The summary block misses money or links written out in words ("five hundred dollars", "evil dot example"). Fix: add the patterns and the red-team cases.
- **NEW-22:** same-household self-referral is not blocked: the guard never compares the referrer with the redeemer (`src/lib/repos/referral.ts`, household check). Fix: store the referrer's household hash when the code is issued.
- **NEW-23:** admin APIs return 401 instead of 403 to signed-in non-admins (`src/lib/auth.ts:60-64`). Admin login lands on `/app/onboarding` (`src/lib/apiClient.ts:124-134`).
- **NEW-24:** "Type instead" only appears after an error (`src/app/(talk)/app/talk/page.tsx:654`). `VOICE_LIMIT_MESSAGE` offers typing even when typing is off (`limits.ts:45`).
- **NEW-25:** the memories load error has no retry button. The message route has no `maxDuration`.
- **NEW-26:** `setup-local-db.sh` doesn't install pgvector when Postgres is already present (see Friction).

## Not verified here
- Real model behaviour for every red-team case (refusals, injection resistance, paraphrased crises). This needs a **test-only** AI key and `npm run test:redteam-live`.
- Crisis cases over voice: the fake STT has a fixed transcript.
- The referral credit applied through a real `invoice.paid` webhook (needs Stripe test keys); covered by unit and route tests.
- Real email, SMS (no Twilio account), Deepgram and ElevenLabs, and the Stripe checkout and portal.
- The README Docker path (no Docker daemon here).
- Production config: Vercel env vars, cron schedule and the GitHub `production` environment reviewers.

## What Petko must do before merging `release/mvp-alpha` → `main`
1. **Have a developer chat fix B1, B3, B4 and B5** (NEW-1 to NEW-4 and NEW-6) on `release/mvp-alpha`, and get CI `build` green.
2. **Prompt sign-offs (humans only):** the AI Safety Reviewer, Gerontology Advisor and Privacy Advisor review and sign the 4 serving prompts: `COMPANION_SYSTEM_V3`, `SAFETY_SCAN_SYSTEM_V2`, `MEMORY_EXTRACTION_SYSTEM_V3` and `CONVERSATION_SUMMARY_SYSTEM_V2`, using `node scripts/sign-prompt.mjs …`. Re-run `npm run check:prompt-signoffs` until it passes. Optionally decide NEW-5 first, so the historical keys don't need signing.
3. **Approve the production migrations 0018–0021** (`0018_auth_hardening`, `0019_parent_summary_consent`, `0020_referral_credit`, `0021_facility_demo_requests`) in the GitHub `production` environment, and take a DB backup first.
4. **Twilio:** create the account and set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`. Until then, crisis alerts go by email only.
5. **Vercel production env vars to confirm:**
   - `ADMIN_ALERT_EMAIL` (required for P3) and `SALES_ALERT_EMAIL`
   - `AI_API_KEY`, `AI_MODEL` (signed default), `AI_SAFETY_MODEL`
   - `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
   - `EMAIL_API_KEY`, `EMAIL_FROM`
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_FAMILY_MONTHLY`, `STRIPE_PRICE_FAMILY_ANNUAL`
   - `SESSION_SECRET`, `CRON_SECRET`
   - `NEXT_PUBLIC_SITE_URL`, `APP_BASE_URL`
   - `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`
   - `FOUNDING_FAMILY_BETA_ENABLED` (+ `FOUNDING_FAMILY_BETA_DAYS`) if the beta is used
   - `DEMO_MODE` **unset**
6. **Vendor terms:** verify the Deepgram and ElevenLabs data-handling TODOs in `docs/voice-selection.md`. Have /privacy and /terms legally reviewed; they are still marked DRAFT.
7. Optional, recommended: a test-only AI key so the next check can run `npm run test:redteam-live`.

## Reviewer lines (release branch)
- **Founder:** the product is demo-ready in ~3 minutes; merge blocked on B1–B5.
- **Product Manager:** every core flow works; demo summary empty (NEW-11); alerts-step consent gap (NEW-13).
- **QA Engineer:** CI red from a time-bomb test (NEW-1); flows pass at 3 widths except the home mobile menu (NEW-4).
- **Security Engineer:** IDOR clean, CSRF guard holds, 0 high advisories; LOW X-Forwarded-For trust and malformed UUID 500s.
- **AI Safety Reviewer:** pipeline wiring correct, but crisis help is lost on refusal and error paths (NEW-2) and alerts aren't durable (NEW-3, NEW-6); prompts unsigned; real model not tested.
- **SEO Lead:** every indexed page scores SEO 100 / a11y 100 in Lighthouse; the blog is correctly noindexed; the sitemap has stable URLs.

## Addendum 2026-11-06: after chat 15 (reviewer)

Chat 15 (#88, PR #89, `4474824`) merged into `release/mvp-alpha` on 2026-11-06. The reviewer re-checked it on this branch with `release/mvp-alpha` merged in (`9d5ab8e`):

| Blocker | Status | Evidence |
|---|---|---|
| B1: CI red (NEW-1 seed time bomb) | **CLOSED** | CI `build` is green on `9d5ab8e`. Local `npm test` passed on the real clock of 2026-11-06: 1397 passed, 15 skipped. `test/seed.test.ts` pins the clock. |
| B2: unsigned serving prompts | **OPEN (humans only)** | `prompt-signoffs` still fails, as expected. Never signed by AI. |
| B3: no crisis help on refused or failed turns (NEW-2) | **CLOSED** | `src/lib/safety/crisisKeywords.ts` runs before every refusal. A failed reply or TTS still returns the crisis copy. Tests: `test/crisisOnRefusal.test.ts`. Chat 15 browser evidence: `evidence/chat-15/talk-crisis-while-rate-limited-*.png`. |
| B4: alerts not durable or honest (NEW-3, NEW-6) | **CLOSED** | The throttle slot is claimed only after delivery. The admin backup is always sent on throttle or failure. A daily retry covers undelivered P0/P1 (migration `0022_safety_alert_attempts`). The "let {buyer} know" wording now follows the alert outcome. Tests: `test/retryAlerts.test.ts`. Retries run daily only (Vercel Hobby); a sub-daily retry needs a paid plan. |
| B5: hidden home mobile menu (NEW-4) | **CLOSED** | `SiteHeader.tsx:21` is now `relative z-40`. The reviewer re-ran it in headless Chromium: on `/` the menu opens and its Pricing link navigates at 375 and 768. Test: `test/siteHeaderStacking.test.tsx`. |

Checks re-run by the reviewer: typecheck ✅, lint ✅, tests ✅ (1397/15 skipped), build ✅. On a fresh local Postgres 16 + pgvector, migrations 0001–0022 applied and seed OK.

**Updated verdict: GO for the private alpha on the code side. Still NO-GO to merge into `main` until B2 is done**: the human reviewers must sign the 4 serving prompts. Items 2–6 of "What Petko must do" above still apply. Item 3 now covers migrations **0018–0022**, which adds `0022_safety_alert_attempts`.

Follow-up (still open): `scripts/autopilot/setup-local-db.sh` still skips installing pgvector when `pg_ctl` already exists (friction 2). This run hit it again.
