# Kindly — AI Prompt Sign-Off Ledger

Companion doc to [prompt_architecture_v1.md](./prompt_architecture_v1.md). That doc
describes *what* the prompts do and *who* must review them; this one is the
formal record of *whether* they have been, for the exact text currently in
`src/lib/ai/prompts.ts`.

**Mechanism:** every prompt below is pinned to the SHA-256 of the text it was
last reviewed at, recorded in `src/lib/ai/promptSignOff.ts`
(`PROMPT_SIGN_OFF`). `test/promptSignOff.test.ts` re-hashes the live constant
on every test run and fails if it no longer matches — so an edit to a prompt
can't ship without someone deliberately updating the ledger (and, in doing so,
either re-running the sign-off or explicitly reverting status to `draft`).
An `approved` entry with an empty `reviewers` list is rejected at module load
time — nobody is accountable for the sign-off otherwise.

## Sign-off matrix

| Prompt | Status | Reviewers | Notes |
|---|---|---|---|
| `COMPANION_SYSTEM_V1` | **draft** | — | Pending AI Safety + Gerontology Advisor sign-off. |
| `SAFETY_SCAN_SYSTEM_V1` | **draft** | — | Pending AI Safety sign-off. |
| `MEMORY_EXTRACTION_SYSTEM_V1` | **draft** | — | Pending Privacy Advisor sign-off. |
| `CONVERSATION_SUMMARY_SYSTEM_V1` | **draft** | — | Pending AI Safety sign-off. Generalized from "older adult" framing to support self-use profiles. |

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
| Elderspeak/tone | ⚠️ partially automated | `test/redteam/elderspeak.test.ts` — `BANNED_OUTPUT_PATTERNS_V1.elderspeak` catches overt patronizing markers (baby talk, diminutive address, patronizing collective "we") + a `COMPANION_SYSTEM_V1` content contract. Full tone judgment (is a given warm phrase patronizing *in context*?) isn't regex-testable and still needs the Gerontology Advisor's manual review at sign-off. |

**Known gap:** `BANNED_OUTPUT_PATTERNS_V1` is defined and tested against, but
there is no runtime post-filter yet applying it to the real model's live
companion replies — today it only guards the deterministic templates
(`crisisResourceV1`, `companionGreetingV1`) and the test suites. Wiring it into
the actual reply path (redact/regenerate on a match, log the violation) is
still open; until then, this is a regression-catching net for the *prompts*
and *fixed copy*, not a live filter on model output.

## How to record a sign-off

1. Get the named reviewer(s) to approve the exact prompt text in
   `src/lib/ai/prompts.ts`.
2. In `src/lib/ai/promptSignOff.ts`, set that entry's `status: 'approved'` and
   `reviewers: [...]`, and update `sha256` to `hashPrompt(<the approved text>)`
   if it isn't already current.
3. Update the matrix above.
4. If the prompt changes again afterward, the integrity test fails until this
   is repeated — that's the point.
