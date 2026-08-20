# Kindly — Prompt Review Packet v1 (pre-review analysis, not a sign-off)

**What this is:** a written analysis of the four production prompts, one
section per prompt × each of the three required reviewer lenses (AI Safety
Reviewer, Gerontology Advisor, Privacy Advisor), prepared to make the actual
review faster — not a substitute for it. **This document records no
approval and changes no ledger entry.** Per
[PROMPT_SIGN_OFF.md](./PROMPT_SIGN_OFF.md), a real sign-off requires a named,
accountable human reviewer running `scripts/sign-prompt.mjs` against the
exact live text; `assertValidEntry` rejects an `approved` decision with no
reviewer for exactly that reason, and this document does not attempt to work
around it.

For each prompt: what's already covered by an automated guardrail (so the
reviewer doesn't need to re-derive it), then open questions/gaps that need a
human judgment call in that reviewer's domain. Items marked **[FIX
CANDIDATE]** are not judgment calls — they're concrete, actionable gaps found
while preparing this packet; call those out separately if you'd like them
fixed before or independent of the sign-off itself.

Prepared against the prompt text in `src/lib/ai/prompts.ts` as of commit
`e528545` (2026-08-20). If the text changes, re-derive this packet —
`test/promptSignOff.test.ts` will catch drift against any *recorded*
sign-off, but this packet itself isn't hash-pinned and can go stale silently.

---

## 1. `COMPANION_SYSTEM_V1`

### AI Safety Reviewer

**Already covered:**
- Explicit AI-identity disclosure required at session start (also enforced
  as a deterministic template, `companionGreetingV1`, so the model can't
  omit it even if it ignores the instruction).
- Hard bans — human/alive claims, feelings claims, medical claims, false
  "I contacted help," credential requests, secrecy promises — are enforced
  twice: as red-team test assertions AND as a runtime post-filter
  (`applyBannedOutputFilter`) that redacts a live violation before it's
  shown to the user or persisted (`src/app/api/talk/message/route.ts`).
- 5 of 6 red-team suites are fully automated and passing (human-impersonation,
  medical-claim, crisis-handling, credential-phishing, emotional-dependency).

**Open questions:**
1. The safety pre-scan and the companion reply run **concurrently**
   (`prompt_architecture_v1.md`'s 3-call design) — the reply model has no
   awareness that the *same* turn was just classified P0/P1. For a P0/P1, the
   deterministic crisis copy is prepended to whatever the reply model wrote,
   but the reply text itself was generated without knowing a crisis was
   detected. Worth confirming this doesn't produce a jarring reply (e.g. warm
   small talk immediately followed by crisis resources) — is a sample of real
   P0/P1 transcripts something you'd want to review before sign-off, or is
   the prepended-resources design sufficient on its own, with the underlying
   reply text left unreviewed?
2. Financial-exploitation and "don't tell my kids" consent-bypass are
   explicitly listed in `PROMPT_SIGN_OFF.md` as **not yet built** as dedicated
   red-team suites (the existing `secrecyPromise` pattern and p2-welfare
   escalation partially cover the consent-bypass angle only). Your call:
   blocking for sign-off, or acceptable as a known gap to close in a later
   cycle?
3. No prompt guidance for the companion taking a side in a family conflict
   the user describes (e.g. "my daughter and I aren't speaking, she's
   wrong"). Not covered by any banned pattern. Minor, but worth a decision on
   whether it needs explicit neutrality language.

### Gerontology Advisor

**Already covered:**
- "Never talk down to the person or treat them as fragile or childish" is
  explicit in the prompt text.
- `elderspeak` pattern catches the most overt patronizing markers (baby talk,
  diminutive pet-name address, "let's use the bathroom" phrasing) and is
  audit-logged for manual review on a match — but does not auto-redact,
  since full tone judgment isn't regex-testable.

**Open questions:**
1. This is the primary prompt where your manual tone judgment is the actual
   gate — regex can't tell if a warm phrase reads as patronizing *in
   context*. Recommend reading the prompt text end-to-end for tone, not just
   scanning for banned words.
2. No explicit guidance on pacing/repetition for cognitive conditions (e.g.
   patience with a repeated question, as might come up with early dementia).
   "Short sentences, one question at a time" is general-purpose warmth
   guidance, not dementia-specific. Is more explicit guidance warranted at
   this stage, or is that over-engineering for an alpha with no
   dementia-specific clinical claims allowed anyway?
3. Voice delivery (ElevenLabs TTS) is a separate open item —
   [voice-selection.md](./voice-selection.md) documents that a human
   listening review of pacing/warmth hasn't happened yet either. Worth
   noting the two reviews are related (text tone + spoken delivery) even
   though they're tracked separately.

### Privacy Advisor

**Already covered:**
- Explicit ban on requesting passwords/SSN/bank details, with an instruction
  to redirect if the user volunteers them anyway — enforced by
  `credentialRequest` + tested.
- "Only refer to things you have been told and confirmed in memories" limits
  the model to the per-parent retrieved context, not general knowledge about
  the person — this is also a hallucination control, but it's load-bearing
  for privacy too.

**Open questions:**
1. **[FIX CANDIDATE, doesn't need your review]** — see the cross-cutting
   note at the bottom: the memory-isolation guarantee this prompt line
   implies (only *this* parent's confirmed memories) is enforced at the
   retrieval-code layer, not by the prompt text itself. Worth you knowing
   that boundary explicitly rather than assuming the prompt is the control.
2. No instruction for what to do when the user volunteers private
   information about a **third party** (e.g. "my daughter had a miscarriage
   last year") rather than about themselves. See the matching, more
   consequential gap under `MEMORY_EXTRACTION_SYSTEM_V1` below — that's
   where it actually matters (whether it gets stored and could reach a
   family summary), but the companion prompt itself is also silent on
   whether to encourage/discourage sharing others' private details in the
   conversation.

---

## 2. `SAFETY_SCAN_SYSTEM_V1`

### AI Safety Reviewer

**Already covered:**
- p0–p3 severity ladder matches the escalation policy in
  `prompt_architecture_v1.md` exactly.
- Crisis-handling red-team suite exercises tier classification via the fake
  AI client across all severities, plus the emotional-dependency suite added
  p2-welfare coverage for isolation/dependency phrasing.

**Open questions:**
1. The prompt is intentionally terse ("Reply only with the classification")
   with no few-shot examples or edge-case guidance — e.g. sarcasm,
   hypotheticals ("if I ever felt like giving up"), or third-person mentions
   (discussing a book/show plot involving self-harm) vs. present-tense
   personal risk. This is a live model call in production, not the
   deterministic fake used in tests — worth deciding whether few-shot
   examples should be added before sign-off, or whether the classifier's
   real-world reliability on ambiguous input is something you're comfortable
   accepting without them.
2. p2 items (hopelessness, not eating, confusion, isolation) have no
   duration/severity calibration in the prompt ("wasn't hungry today" vs.
   "hasn't eaten in three days" would presumably both map to p2). Is a
   single "welfare" tier granular enough, or should some p2 signals escalate
   faster than others?

### Gerontology Advisor

**Open question (this is really your prompt to review):**
The p2 "welfare" signal list — hopelessness, not eating, confusion,
isolation — was chosen by engineering judgment, not clinical input. Does
this list reflect the actual early-warning signs worth watching for in this
population? A known example: sudden new confusion in an older adult is a
classic marker for delirium (often from a UTI or medication interaction),
not just a vague "welfare" concern — worth deciding whether that distinction
matters enough to change the prompt's p2 language or add a p1-adjacent
escalation path.

### Privacy Advisor

**Already covered:**
- The scan returns only `{severity, rationale}`, not the raw message; the
  stored `safety_flag` record is described in code comments as "minimized
  detail — rationale, never the raw message."

**Open question:**
1. **[FIX CANDIDATE]** — nothing in the prompt text actually instructs the
   model to avoid quoting the user's exact words *inside* the rationale
   field. The code's privacy assumption ("rationale, never the raw message")
   is enforced by convention, not by an explicit prompt constraint or a
   code-level check on the rationale content. A model that classifies P0 and
   writes `rationale: "user said 'I don't want to live anymore'"` would
   satisfy the schema while defeating the minimization intent. Recommend
   adding an explicit line to the prompt ("Do not quote the person's exact
   words in the rationale — describe the concern in your own words") — happy
   to make that change if you'd like it done before your review rather than
   as a follow-up.

---

## 3. `MEMORY_EXTRACTION_SYSTEM_V1`

### AI Safety Reviewer

**Already covered:**
- "Do NOT invent facts" is explicit; empty-list fallback when nothing
  durable was shared.
- Low direct safety surface — this prompt doesn't talk to the user, so the
  main risk is a bad memory persisting and being reflected back later (e.g.
  a fabricated relationship detail) rather than an in-the-moment harm.

**Open question:**
The confidence threshold that discards low-confidence candidates
(`minConfidence` in `src/lib/jobs/sessionEnd.ts`) is enforced in **code**,
not stated as a number in the prompt itself. Worth knowing that boundary —
the model's own confidence self-report is a soft signal filtered downstream,
not something the prompt guarantees on its own.

### Gerontology Advisor

Limited direct relevance — the main touchpoint is that `restricted`
sensitivity (health/mood/risk) is what keeps clinical-adjacent content out of
family-facing surfaces later. No content-quality concerns specific to this
prompt beyond what's already covered elsewhere.

### Privacy Advisor

**This is the prompt where your review matters most.**

**Already covered:**
- Three-tier sensitivity model (`normal`/`sensitive`/`restricted`), with
  health/mood/risk content mandatorily tagged `restricted`.
- Restricted memories are excluded from the companion's own retrieved
  context (per `prompt_architecture_v1.md`'s layered-context diagram) and
  from family-facing summaries, with a **code-level backstop**
  (`RESTRICTED_SUMMARY_PATTERN` + `sanitizeFamilySummary`) that redacts a
  summary if the model leaks restricted terms anyway — defense-in-depth, not
  just a prompt instruction.

**Open question — the most substantive gap found in this pass:**
The prompt extracts facts "about an older adult" from the conversation, but
says nothing about what to do when the older adult volunteers **private
information about someone else** — e.g. "my daughter had a miscarriage last
year" or "my son is having money trouble." As written, such a statement
could plausibly be extracted as a normal-sensitivity memory about the
*parent* (since it's a fact they stated), with no signal that the actual
subject of the sensitive content is a **third party** — one who may
literally be a `summary_recipient` on the weekly family summary. This is a
real, unaddressed privacy gap, not a stylistic one: the current pipeline has
no mechanism to recognize "this fact is sensitive information about person
X, who might read about it." Recommend deciding whether this needs a prompt
change (e.g. "if a stated fact is actually private information about someone
other than the person you're talking to, treat it as at least
`sensitivity=sensitive`") before sign-off, since it's squarely a privacy
design question, not an engineering one.

---

## 4. `CONVERSATION_SUMMARY_SYSTEM_V1`

### AI Safety Reviewer

**Already covered:**
- "No diagnosis language," "nothing sensitive about health/mood/risk as a
  shareable detail" are explicit prompt rules, backed by the same
  code-level `RESTRICTED_SUMMARY_PATTERN` redaction backstop described above.

**Open question — [FIX CANDIDATE], flagging for visibility even though it's
not a text-content question:**
When the backstop actually fires (the model ignored the prompt and leaked
restricted content, which *would* mean a prompt-adherence regression worth
knowing about), the only signal today is `console.warn` in
`src/lib/jobs/sessionEnd.ts:100` — no Sentry alert, no audit log entry,
nothing visible outside a server log nobody is tail-ing. This is the exact
anti-pattern the codebase already identified and fixed elsewhere: the commit
that added Sentry alerting to weekly-summary delivery failures says, almost
verbatim, "console.error alone is silent in practice — nobody's watching
stdout." A redaction here means the model didn't follow
`CONVERSATION_SUMMARY_SYSTEM_V1`'s rules in production — exactly the kind of
regression a reviewer would want surfaced, not silently swallowed. Recommend
wiring this to Sentry (and/or an audit-log entry, consistent with how
`banned_output_redacted` is handled) before or alongside sign-off. This is a
straightforward code fix, not a judgment call — say the word and I'll make
it.

### Gerontology Advisor

Same tone considerations as `COMPANION_SYSTEM_V1` apply to summary phrasing
("warm, plain sentences") but the audience here is the *family*, not the
older adult directly — worth a quick read for whether the tone lands right
for an adult child reading about their parent, which is a different bar than
warmth toward the parent themselves.

### Privacy Advisor

**Already covered:**
- Mandatory exclusion of health/mood/risk shareable detail, redaction
  backstop as above, coarse (not diagnostic) mood signal only
  (`warm`/`flat`/`low`/`null`).

**Open question:**
Same third-party angle as the memory-extraction prompt: if a session
touched on private information about someone other than the parent, does
"warm, non-clinical summary" implicitly exclude that, or could it still
surface (e.g. "Mom mentioned she's worried about [sibling]'s job situation")
in a summary sent to multiple family recipients, including possibly that
sibling? Worth a explicit decision alongside the memory-extraction gap above
— they're the same underlying issue at two different points in the
pipeline.

---

## Cross-cutting notes (not specific to one prompt)

- **Memory isolation is a system property, not a prompt property.** Several
  prompt lines ("only refer to confirmed memories," restricted content
  "excluded from context") describe behavior that depends on the
  *retrieval code* correctly scoping queries per-parent — the prompt text
  can't enforce that on its own. Worth the Privacy Advisor knowing this
  boundary explicitly so review effort isn't spent re-verifying something
  the prompt text can't actually control.
- **Third-party privacy** (a parent sharing private info about a family
  member other than themselves) is the single most substantive gap found
  across this pass, touching both `MEMORY_EXTRACTION_SYSTEM_V1` and
  `CONVERSATION_SUMMARY_SYSTEM_V1`. Recommend the Privacy Advisor treat this
  as one decision to make once, not two separate prompts to reason about
  independently.
- **Two fix candidates identified are pure engineering fixes**, not
  judgment calls, and don't need to wait for a reviewer's calendar:
  1. Add an explicit "don't quote the person's exact words" instruction to
     `SAFETY_SCAN_SYSTEM_V1`'s rationale output.
  2. Wire the summary-redaction backstop's `console.warn` to Sentry (+
     optionally an audit-log entry), matching the pattern already used for
     `banned_output_redacted` and weekly-summary delivery failures.

  Say the word and both can be made and tested before real review starts —
  neither changes prompt *behavior* in a way that would need re-review of
  content, just observability/precision.

## What this packet does NOT do

It does not approve anything, and it should not be treated as one role's
opinion standing in for another's. `scripts/check-prompt-signoffs.mjs` will
continue to report 0/3 for all four prompts until real reviewers record real
decisions via `scripts/sign-prompt.mjs`. This document exists only to make
that a faster, more informed conversation.
