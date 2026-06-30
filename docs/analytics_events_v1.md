# Kindly — Analytics & Tracking Event Plan v1 (Alpha v0.1)

**Owner:** Data Analyst · **Reviewers:** Backend Dev, Product Manager, Security Engineer
**Approach:** client emits events to analytics provider; critical funnel + product events are also mirrored server-side into `analytics_events` (source of truth for KPIs). No PII in event props — use `user_id` / `parent_id` references, never email/name. No conversation content in any event, ever.

## Naming convention
`object_action`, snake_case. Props are typed. Every event carries `{ts, user_id?, parent_id?, session_id}` automatically.

## Funnel events (public site → activation)

| Event | Where | Key props | KPI it feeds |
|---|---|---|---|
| `page_viewed` | all public pages | `slug, referrer, utm` | Traffic, page performance |
| `cta_clicked` | hero/sections | `slug, cta_id` | CTR to onboarding/waitlist |
| `waitlist_joined` | /waitlist | `source_page, wants_demo` | Waitlist signups (target 100–500/wk) |
| `demo_requested` | /demo | `source_page` | Demo requests (target 10–50/wk) |
| `account_created` | /app/onboarding | `method` | Signup conversion |
| `onboarding_step_completed` | onboarding | `step_index, step_name` | Funnel drop-off |
| `parent_profile_created` | onboarding | — | Activation step |
| `memory_added` | /app/memories | `layer, source` | Setup depth |
| `consent_recorded` | onboarding/talk | `kind` | Consent compliance |
| `parent_activated` | onboarding | — | Activated parents |
| `access_link_issued` | onboarding | — | Handoff to parent |
| `checkout_started` | /pricing,/app | `plan` | Purchase funnel |
| `subscription_started` | webhook | `plan, status` | Paid users (target 5–30/wk) |

## Product / engagement events

| Event | Key props | KPI |
|---|---|---|
| `talk_session_started` | `channel` | Active parents, DAU/WAU |
| `talk_message_sent` | `role, channel` | Engagement depth |
| `voice_minute_logged` | `minutes` (server) | **Cost per voice minute** |
| `talk_session_ended` | `duration_s, turn_count` | Session length, retention |
| `memory_candidate_extracted` | `layer, accepted?` | Memory system quality |
| `summary_preview_generated` | `has_concern` | Weekly value delivery |
| `summary_sent` | `channel, recipient_count` | Family value |
| `sibling_invited` | — | Virality (family expansion) |
| `referral_created` | — | Referral funnel |
| `referral_redeemed` | — | Referral conversion |
| `safety_flag_raised` | `severity` (server only) | Safety monitoring |

## Admin / business KPIs (derived)

| KPI | Definition |
|---|---|
| Cost per active user | infra+AI cost ÷ weekly active parents |
| Cost per voice minute | voice/STT/TTS cost ÷ Σ `voice_minute_logged` |
| Retention (W1/W2/W4) | % activated parents with ≥1 `talk_session_started` in week N |
| Family value | % parents with ≥1 `summary_sent` and ≥2 recipients |
| Activation rate | `parent_activated` ÷ `account_created` |
| Paid conversion | `subscription_started` ÷ `account_created` |

## Privacy guardrails (hard rules)
- No event ever contains conversation text, memory values, email, or full name.
- `safety_flag_raised` is **server-side only**, severity-coded, no detail text in analytics.
- Honor Do-Not-Track / no-consent: suppress client analytics, keep minimal server funnel counts only.
- Events are retained per the data-retention policy and included in delete/export requests.
