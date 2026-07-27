# Kindly — AI Prompt Sign-Off Ledger

Companion doc to [prompt_architecture_v1.md](./prompt_architecture_v1.md). That doc
describes *what* the prompts do and *who* must review them; this one is the
formal record of *whether* they have been, for the exact text currently in
`src/lib/ai/prompts.ts`. See [prompts/README.md](../prompts/README.md) for the
step-by-step workflow (how to add a new prompt, how to record a sign-off).

**Mechanism:** the raw, append-only log of who-approved-what-when lives in
[prompts/signoffs.json](../prompts/signoffs.json), one entry per
(prompt, role, decision) event, each pinned to the SHA-256 of the exact prompt
text it was recorded against. `src/lib/ai/promptSignOff.ts` is the typed read
side — it re-hashes the live prompt on every read and reports per-role status
(`getPromptSignOffStatus`). Three things read this:

- **`test/promptSignOff.test.ts`** (part of `npm test`/CI): DRIFT-ONLY. Fails
  if a role's most recent approval no longer matches the live prompt hash — a
  prompt edited after being reviewed, without redoing the review. Never fails
  just because a role hasn't reviewed yet (today's actual state).
- **`npm run check:prompt-signoffs`** (NOT part of `npm test`): the STRICT
  release-readiness gate. Requires all three roles — AI Safety Reviewer,
  Gerontology Advisor, Privacy Advisor — approved at the current hash, for
  every registered prompt. Deliberately run by hand before a release, not on
  every commit, since it's expected to fail until real reviewers act.
- **`GET /api/admin/prompt-signoff-status`**: the same status, machine-readable,
  for the future "Reviewed for safety" admin badge.

Record a sign-off with:

```
node scripts/sign-prompt.mjs --prompt <PROMPT_KEY> --role safety|gerontology|privacy \
  --reviewer "Name" --decision approved|changes_requested --notes "..."
```

## Sign-off matrix

Status per role, computed against the current prompt text (all four prompts
are unreviewed by any role today):

| Prompt | AI Safety Reviewer | Gerontology Advisor | Privacy Advisor |
|---|---|---|---|
| `COMPANION_SYSTEM_V1` | — pending | — pending | — pending |
| `SAFETY_SCAN_SYSTEM_V1` | — pending | — pending | — pending |
| `MEMORY_EXTRACTION_SYSTEM_V1` | — pending | — pending | — pending |
| `CONVERSATION_SUMMARY_SYSTEM_V1` | — pending | — pending | — pending |

The deterministic templates (`companionGreetingV1`, `crisisResourceV1`,
`sanitizeFamilySummary`) are not model prompts — they're fixed copy the model
can never omit or alter — so they aren't gated the same way, but any edit to
their text still needs AI Safety review per the hard rules in
prompt_architecture_v1.md (988/911 crisis copy, AI-identity disclosure).

## Red-team suites (must pass before merge to `dev`)

Per prompt_architecture_v1.md §"Versioning & testing". Automated coverage
lives in `test/redteam/*.test.ts` (one file per suite) and runs in CI as part
of `npm test`. Each suite pairs banned-output-pattern checks with a *content
contract* on the relevant prompt text — so a reviewed, hash-updated edit that
accidentally drops a safety clause fails CI too, not just a silent edit.

| Suite | Automated? | Where |
|---|---|---|
| Human-impersonation | ✅ | `test/redteam/humanImpersonation.test.ts` — `BANNED_OUTPUT_PATTERNS_V1.humanClaim` / `.hasFeelings` + `COMPANION_SYSTEM_V1` content contract |
| Medical-claim | ✅ | `test/redteam/medicalClaim.test.ts` — `BANNED_OUTPUT_PATTERNS_V1.medicalClaim` + `COMPANION_SYSTEM_V1` / `CONVERSATION_SUMMARY_SYSTEM_V1` content contracts |
| Crisis-handling | ✅ | `test/redteam/crisisHandling.test.ts` — `BANNED_OUTPUT_PATTERNS_V1.contactedHelp` + `crisisResourceV1` + `fakeAiClient.safetyScan` tier classification + `SAFETY_SCAN_SYSTEM_V1` content contract |
| Credential-phishing | ✅ | `test/redteam/credentialPhishing.test.ts` — `BANNED_OUTPUT_PATTERNS_V1.credentialRequest` + `COMPANION_SYSTEM_V1` content contract |
| Emotional-manipulation / dependency | ✅ | `test/redteam/emotionalDependency.test.ts` — `BANNED_OUTPUT_PATTERNS_V1.secrecyPromise` + `COMPANION_SYSTEM_V1` anti-isolation content contract + `fakeAiClient.safetyScan` p2-welfare escalation on isolation/dependency language |
| Elderspeak/tone | ⚠️ partially automated | `test/redteam/elderspeak.test.ts` — `BANNED_OUTPUT_PATTERNS_V1.elderspeak` catches overt patronizing markers (baby talk, diminutive address, patronizing collective "we") + a `COMPANION_SYSTEM_V1` content contract. Full tone judgment (is a given warm phrase patronizing *in context*?) isn't regex-testable and still needs the Gerontology Advisor's manual review at sign-off. |

Not yet built as a dedicated suite: **financial exploitation** (a third party
extracting financial info through the companion) and the **"don't tell my
kids" consent-bypass** scenario. `secrecyPromise` and the p2-welfare
escalation partially cover the consent-bypass angle today; a standalone suite
is still open.

## Runtime enforcement (closed — previously a known gap)

`BANNED_OUTPUT_PATTERNS_V1`'s hard-ban keys (`humanClaim`, `hasFeelings`,
`medicalClaim`, `contactedHelp`, `credentialRequest`, `secrecyPromise`) are now
applied to every live companion reply by `src/lib/ai/outputFilter.ts`
(`applyBannedOutputFilter`), wired into `/api/talk/message`. A hard-ban match
redacts the reply to a safe, deterministic fallback line before it's surfaced
or persisted, and audit-logs the violation (`banned_output_redacted`).
`elderspeak` is a softer, tone-based signal — a match is audit-logged
(`banned_output_review_flag`) for manual Gerontology Advisor review, but the
reply is NOT auto-redacted, since full tone judgment isn't regex-testable and
an auto-rewrite risks replacing an actually-fine reply.

## How to record a sign-off

See [prompts/README.md](../prompts/README.md) for the full workflow. Short version:

1. Get the named reviewer to approve the exact prompt text in
   `src/lib/ai/prompts.ts`.
2. Run `node scripts/sign-prompt.mjs --prompt <KEY> --role <role> --reviewer "<name>" --decision approved`.
3. Update the matrix above.
4. If the prompt changes again afterward, `test/promptSignOff.test.ts` fails
   until this is repeated — that's the point.
