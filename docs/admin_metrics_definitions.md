# Kindly — Admin Cost & Retention Metrics v1 (feature/admin-analytics)

**Owner:** Data Analyst · **Reviewers:** Product Manager, Security Engineer
**Approach:** computed directly from `conversations`, `conversation_turns`, `parents`, `users`, and `usage_costs` — not from `analytics_events`. See "Supersedes" below for why. No conversation content, no parent name and no parent id appears anywhere in the admin API response or UI. Every number is an aggregate, with one exception: the **top 10 spenders** list (below), which shows each parent's spend under a pseudonymous 8-character ref. Access is gated by the same `resolveAdmin` check as every other admin route (`src/lib/auth.ts`).

## Definitions

**Active user** — a **parent** (not the buyer) with ≥1 `conversations` row whose `started_at` falls in the period. Parents are who generate the Deepgram/ElevenLabs usage cost; a buyer with two active parents counts as two active users. Implemented in `src/lib/repos/adminMetrics.ts` (`costBuckets`).

**Voice minute** — Deepgram's returned audio duration (`durationSeconds` from `speech.speechToText`, already summed into `conversations.voice_minutes`). For this integration, raw audio duration **is** the billed quantity: Deepgram's Nova-2 pricing bills per second with no minimum rounding, so there is no raw-vs-billed divergence to reconcile here.

**W1 / W2 / W4 retention** — discrete, non-overlapping day windows anchored on `parents.activated_at` ("first active day"), **not** calendar weeks and **not** cumulative:
- W1 = ≥1 conversation with `started_at` in days **[1, 7]** after `activated_at`
- W2 = days **[8, 14]**
- W4 = days **[22, 28]**

A parent silent in week 1 but active in week 2 still counts for W2. The denominator (`eligible`) for each window excludes parents whose window hasn't fully elapsed yet as of the reference time (`activated_at` too recent) — it is not "all activated parents," which would understate retention for a young cohort. `pct` is `null`, not `0` or `NaN`, when `eligible` is 0. Implemented in `src/lib/repos/adminMetrics.ts` (`retention`).

**Cost per active user** = (Anthropic LLM cost + Deepgram STT cost + ElevenLabs TTS cost) ÷ active users in the period. In weekly view this is the **cost per active parent per week**. Text-only conversations now carry their LLM cost, so they no longer show $0.

**Cost per voice minute** = all cost (LLM + STT + TTS) ÷ total voice minutes in the period. Shown with 4 decimals under one cent.

**LLM cost** (since chat 5) — every Anthropic call writes a `usage_costs` row with `provider = 'anthropic_llm'`, `unit = 'token'`, `input_tokens`, `output_tokens`, `model` and `operation`: `reply`, `regeneration` and `scan` per turn (tied to the companion's turn), and `summary` and `extraction` at session end (no turn). Prices per model are in `src/lib/billing/usageRates.ts` (`LLM_MICROS_PER_TOKEN`, from the Claude API pricing page); an unknown model is priced at the Opus rate so it is never under-counted. The simulated (fake) AI writes no rows.

**Top 10 spenders** — the parents with the highest total cost over the last 30 days, with conversation count, voice minutes and the LLM/speech split, under `parent_ref` (first 8 hex characters of the parent id). Its purpose is spotting a leaked talk link or runaway use; admins resolve the ref in the database to act.

## Cost pipeline

Neither Deepgram nor ElevenLabs returns a per-request dollar cost in their API responses (confirmed by reading `src/lib/speech/providers.ts`), so cost is computed in real time, at the point of each call, from an internal rate table — not read from either provider and not reconciled post-hoc. Each Deepgram STT call and each ElevenLabs TTS call writes one row to `usage_costs` (`db/migrations/0012_usage_costs.sql`), FK'd to the `conversation_turns` row it produced, from `src/app/api/talk/voice/route.ts`. Since migration 0016 that foreign key is `ON DELETE SET NULL`, so cost history survives the 30-day transcript purge (it used to cascade away with the purged turns). A `usage_costs` write failure is caught and logged, never fails the parent-facing request — cost accounting is auxiliary to the product experience, not part of its correctness contract.

Rate constants (`src/lib/billing/usageRates.ts`) — list pricing captured 2026-07, must be reverified periodically against actual provider invoices (they will drift if either provider changes pricing):

| Provider | Rate | Unit | Source |
|---|---|---|---|
| Deepgram Nova-2 STT | $0.0043/minute, billed per-second, no rounding | second | [brasstranscripts.com](https://brasstranscripts.com/blog/deepgram-pricing-per-minute-2025-real-time-vs-batch) |
| ElevenLabs Multilingual v2 TTS | $0.10 per 1,000 characters | character | [elevenlabs.io/pricing/api](https://elevenlabs.io/pricing/api) |

Cost is stored as **micros** (millionths of a dollar) to avoid float precision loss on sub-cent per-turn amounts. `quantity` and the full-precision `unit_rate_micros` are stored alongside the rounded `cost_micros`, so every row is independently reproducible and auditable rather than only carrying a bare total.

## Supersedes

This doc supersedes 3 rows of `docs/analytics_events_v1.md`'s "Admin / business KPIs (derived)" table: **Cost per active user**, **Cost per voice minute**, and **Retention (W1/W2/W4)**. Those rows are defined in terms of `talk_session_started`, `voice_minute_logged`, and `parent_activated` analytics events — none of which are actually emitted anywhere in this codebase (only `account_created`, `page_viewed`, `cta_clicked`, `waitlist_joined`, and `demo_requested` are ever inserted into `analytics_events`). Rather than building on that non-existent instrumentation, this feature computes the same three KPIs directly from tables that are already real and populated. No other row of `docs/analytics_events_v1.md` — funnel events, other product events, or the privacy guardrails — is affected; that document stands unchanged for everything else.
