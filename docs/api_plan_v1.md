# Kindly — Backend API Route Plan v1 (Alpha v0.1)

**Owner:** Backend Dev · **Reviewers:** Privacy Advisor, Security Engineer, Product Manager, QA
**Conventions:** Next.js route handlers under `/app/api/*`. JSON. Auth via session cookie (buyer/admin) or signed access token (parent talk). All parent-scoped routes resolve `parent_id` from the caller's identity — never trust a `parent_id` from the client body for authorization. All mutating routes are idempotent where noted. All admin + sensitive reads write to `audit_log`.

Legend — Auth: `public` | `buyer` (session) | `parent` (access token) | `admin`.

---

## Public funnel

| Method | Route | Auth | Purpose | Acceptance |
|---|---|---|---|---|
| POST | `/api/waitlist` | public | Create waitlist signup `{email, source_page, utm, wants_demo}` | 201; dedupes by email; emits `waitlist_joined` |
| POST | `/api/demo` | public | Demo request (sets `wants_demo=true`) | 201; emits `demo_requested` |

## Auth

| Method | Route | Auth | Purpose | Acceptance |
|---|---|---|---|---|
| POST | `/api/auth/signup` | public | Create buyer `{email, password\|magic}` | 201; no duplicate email; emits `account_created` |
| POST | `/api/auth/login` | public | Login | 200 + session; rate-limited |
| POST | `/api/auth/logout` | buyer | End session | 204 |
| POST | `/api/auth/magic` | public | Send magic link | 200 (always, no user enumeration) |

## Parent profile + memories

| Method | Route | Auth | Purpose | Acceptance |
|---|---|---|---|---|
| GET | `/api/parents` | buyer | List own parents (newest first) | 200; buyer-scoped, excludes soft-deleted |
| POST | `/api/parents` | buyer | Create parent profile (onboarding) | 201; not activated until consent gate |
| GET | `/api/parents/:id` | buyer | Read own parent | 200; 403 if not owner (isolation test) |
| PATCH | `/api/parents/:id` | buyer | Update profile/accessibility | 200 |
| DELETE | `/api/parents/:id` | buyer | Soft-delete → hard-delete job | 202; queues purge |
| POST | `/api/parents/:id/activate` | buyer | Activate after consent gate | 200 only if buyer_attestation consent exists; else 409 |
| POST | `/api/parents/:id/access-link` | buyer | Issue passwordless talk link | 201; returns raw token once; stores hash |
| POST | `/api/parents/:id/access-link/revoke` | buyer | Revoke token | 200 |
| GET | `/api/parents/:id/memories` | buyer | List memories | 200; supports `?layer=&status=` |
| POST | `/api/parents/:id/memories` | buyer | Add memory (onboarding seed) | 201; `source=onboarding`, `status=confirmed` |
| PATCH | `/api/memories/:mid` | buyer | Confirm/edit/retire a proposed memory | 200; status transition validated |
| DELETE | `/api/memories/:mid` | buyer | Hard-delete memory | 200; removed from active store |

## Consent

| Method | Route | Auth | Purpose | Acceptance |
|---|---|---|---|---|
| POST | `/api/parents/:id/consent` | buyer | Record buyer_attestation or summary_recipient | 201 |
| POST | `/api/talk/consent` | parent | Record parent_conversation consent (first session) | 201; blocks conversation until present |
| POST | `/api/consent/:cid/revoke` | buyer | Revoke a consent | 200; cascades (recipient stops receiving) |

## Conversation (parent talk)

| Method | Route | Auth | Purpose | Acceptance |
|---|---|---|---|---|
| POST | `/api/talk/session` | parent | Open conversation; returns greeting w/ AI-identity disclosure | 201; 403 if no parent_conversation consent |
| POST | `/api/talk/message` | parent | Send turn `{conversation_id, content}` → companion reply | 200; injects retrieved memories; runs safety scan |
| POST | `/api/talk/voice` | parent | Voice turn (audio in → STT → reply → TTS url) | 200; logs `voice_minutes`; <2.5s perceived start |
| POST | `/api/talk/session/end` | parent | End session → triggers summarize + memory extraction jobs | 200 |

## Summaries

| Method | Route | Auth | Purpose | Acceptance |
|---|---|---|---|---|
| GET | `/api/parents/:id/summary/preview` | buyer | Generate/return current-week preview | 200; excludes restricted memories |
| POST | `/api/parents/:id/summary/send` | buyer | Send to consented recipients | 200; 409 if no consented recipient |
| GET | `/api/parents/:id/summaries` | buyer | List past summaries | 200 |

## Family / referral

| Method | Route | Auth | Purpose | Acceptance |
|---|---|---|---|---|
| GET | `/api/parents/:id/recipients` | buyer | List summary recipients (pending + accepted) | 200; safe view — no invite token hash |
| POST | `/api/parents/:id/invite-sibling` | buyer | Invite sibling as summary recipient `{email}` | 201; creates pending consent + email |
| GET | `/api/referrals` | buyer | Read own referral code (or null) | 200 |
| POST | `/api/referrals` | buyer | Generate referral code | 201; unique code; emits `referral_created` |
| POST | `/api/referrals/redeem` | public | Redeem code at signup | 200; fraud guard one/household |

## Admin

| Method | Route | Auth | Purpose | Acceptance |
|---|---|---|---|---|
| GET | `/api/admin/overview` | admin | Signups, active users, cost/active user, cost/voice min, retention | 200; audit-logged |
| GET | `/api/admin/flags` | admin | Safety flag queue | 200; audit-logged |
| PATCH | `/api/admin/flags/:fid` | admin | Update flag status | 200; audit-logged |

## Internal jobs (not public HTTP — queue/cron)

| Job | Trigger | Purpose |
|---|---|---|
| `summarize_conversation` | session end | Write `conversations.summary_text` + `mood_signal` |
| `extract_memory_candidates` | session end | Insert `proposed` memories from transcript |
| `embed_memories` | new/confirmed memory | Populate `embedding` |
| `generate_weekly_summary` | weekly cron | Build `weekly_summaries` rows in `preview` |
| `purge_hard_deletes` | daily cron | Honor delete within 30 days; purge expired transcripts |
| `detect_safety_flags` | each message | Classify P0–P3, write `safety_flags`, route alerts |

**Error contract:** `{ error: { code, message } }`; never leak another parent's existence (404 not 403 on cross-tenant). **Rate limits:** auth + talk endpoints throttled. **PII in URLs:** never — all sensitive payloads in body.
