# Founder decisions (copy for autopilot sessions, 2026-10-30)

Source of truth: the project doc `claude/kindly-decisions.md`. While a decision
is PENDING, use the recommended default and say so in the PR body.

| # | Decision | Status / what to do |
|---|---|---|
| D1 | Brand name | **DECIDED 2026-10-30: Dearly.** Every user-facing surface says Dearly (copy, metadata, manifest, emails, OG image, the AI's self-introduction). Chat 13 brings the README and any leftover user-facing "Kindly" into line. Internal identifiers (repo, cookies, DB names) stay. |
| D2 | Crisis alerting | **DECIDED:** the gift buyer gets email + SMS within 5 min on P0/P1; P3 never goes to family (internal admin only); max 1 alert per parent per 30 min; the companion tells the parent honestly "I'm going to let {buyer first name} know so they can check on you", never claims to have called anyone. Shipped in #66. Phone + SMS consent UI is chat 10; the parent notice is chat 9. Twilio keys don't exist yet (fake/`not_configured`). |
| D3 | Mood in family summaries | PENDING → default: **remove the mood heads-up** until the parent consents to sharing summaries, then make it a separate opt-in. (Chat 9) |
| D4 | Launch pricing | PENDING → default: ship what the code has ($29/month or $278.40/year, 7-day trial). Show the trial on the pricing card. Defer $49/$79 tiers, the $99 gift and the facility pilot. (Chat 13) |
| D5 | Weekly summary delivery | Implemented in chat 6 (#73): opt-in auto-send for the previous full week; manual send stays. Since #74 auto-send also needs a verified buyer email. |
| D6 | Restricted memories | **DECIDED + implemented (#71):** restricted candidates are dropped; a CHECK forbids them. Never show them to family. |
| D7 | Sibling accounts | PENDING → default: siblings stay **email-only summary recipients**, no login, in alpha. (Chat 10) |
| D8 | Parent awareness of memory | PENDING → default: on the first session the companion says it remembers things like favourite music and that the family can see what it remembers; it answers "what do you remember about me?" honestly. (Chat 9) |
| D9 | voice-only talk branch | Done (#65). |
| D10 | `origin/dev` | PENDING → frozen; ignore it. |
| D11 | Sensitive memories in companion context | PENDING (default implemented in #71): included in a `<sensitive_memories>` block, "never bring them up first". Awaiting Gerontology/Privacy review. Don't change it. |
| D12 | Autopilot | **DECIDED 2026-10-30:** AI developer + separate AI reviewer; merges go to `release/mvp-alpha` only; Petko does the one final merge to `main` after chat 14's GO. Human-only: production migrations/deploys, prompt sign-offs, live keys. |
