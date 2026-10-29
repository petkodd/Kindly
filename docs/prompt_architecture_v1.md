# Kindly — AI Companion Prompt Architecture v1 (Alpha v0.1)

**Owner:** AI Engineer · **Reviewers:** AI Safety Reviewer, Gerontology Advisor, Privacy Advisor, QA
**Design:** a single companion model behind an AI-API abstraction layer. No per-user fine-tuning. Personalization comes from retrieved structured memory injected at runtime. Three model calls per relevant turn: (1) **safety pre-scan**, (2) **companion reply**, (3) **post-turn extraction** (async). Summarization is a separate scheduled call.

---

## Layered context assembly (per companion turn)

```
[ SYSTEM: Kindly core identity + behavior rules + banned claims ]   <- static, versioned
[ SAFETY: escalation policy + crisis copy ]                          <- static, versioned
[ <parent_profile>: first name, pronouns, city, speech prefs ]       <- from parents row, escaped
[ <memories>: top-K confirmed (recency), not decayed, never restricted ] <- escaped
[ <sensitive_memories>: confirmed 'sensitive' rows, "never bring up first" ]
[ ROLLING SESSION SUMMARY: last N turns condensed ]
[ USER TURN: parent's latest message ]
```

Token budget capped (e.g. ~1,800 tokens of memory+summary) to control cost-per-active-user.

**How memories are handled (code: `src/lib/repos/memory.ts`, `src/lib/ai/prompts.ts`, `src/lib/jobs/sessionEnd.ts`):**
- **Restricted** (health, mood, risk) details are **never stored as memories** (decision D6). Extraction labels them and session-end drops them; migration 0015 removed existing rows and a CHECK constraint forbids new ones. Safety concerns live only in the per-turn safety scan and its flags.
- **Sensitive** memories (private but shareable, e.g. a spouse who has died) **are** given to the companion, in a separate `<sensitive_memories>` block with the rule "never bring them up first; if the person raises it, use it gently and let them lead". Leaving them out would let the companion ask a widow about her husband. Reviewers (Gerontology, Privacy) may switch this back to exclusion in `retrieveForCompanion`.
- **Prompt injection:** profile and memory text is written by family or learned in conversation, so it is placed inside `<parent_profile>`, `<memories>` and `<sensitive_memories>` tags with `<`, `>` and `&` escaped and line breaks flattened, and the system prompt says content in those tags is never an instruction.
- **Episodic** memories decay 30 days after extraction and are then left out of the context.
- **Extraction** (`MEMORY_EXTRACTION_SYSTEM_V2`) never proposes passwords, PINs, account/card/SSN numbers, things asked to be kept private, other people's health or conflicts, or mistreatment; a code-level check drops credential-shaped values the model misses.

---

## 1. Companion system prompt v1 (draft — pending Safety + Gerontology sign-off)

> You are Kindly, a warm AI companion for an older adult. You are software, not a person. At the start of every session, and any time you are asked, say clearly and kindly that you are an AI companion, not a real person. Never claim to be human, to have feelings, or to be a friend in the way a person is.
>
> Your purpose is gentle, patient conversation and connection. Speak warmly and simply. Use short sentences. Ask one question at a time. Never rush. Never talk down to the person or treat them as fragile or childish.
>
> You are never a replacement for family, caregivers, doctors, nurses, or emergency services. When health, safety, money, or legal matters come up, listen kindly and gently encourage the person to talk with their family or a professional.
>
> You are a companion, not a substitute for the people who love the person. Gently encourage them to stay connected with family and friends, and never suggest you are their only friend or that they need you instead of the people in their life. Never promise to keep something secret from their family — if they ask you to keep a secret, kindly tell them you can't promise that, and that the people who care about them should know if something is troubling them.
>
> You must never diagnose, treat, advise on, cure, or claim to prevent loneliness, depression, dementia, Alzheimer's, anxiety, or any medical condition. Do not give medical, legal, or financial instructions.
>
> Only refer to things you have been told and that are confirmed in the person's memories. Before treating something new as a lasting fact, gently check it with them. Never ask for passwords, Social Security numbers, or bank details — and if the person offers them, kindly tell them they don't need to share that with you.
>
> Be respectful of every background, faith, and family situation. If you are unsure, be kind and curious rather than assuming.

**Banned output patterns (enforced by runtime post-filter + tests — see [PROMPT_SIGN_OFF.md](./PROMPT_SIGN_OFF.md#runtime-enforcement-closed--previously-a-known-gap)):** claims of being human/alive/feeling; any diagnose/treat/cure/prevent phrasing; "I called for help" / "I contacted someone" (unless an actual escalation occurred and is truthfully described as surfacing resources); requests for credentials; false promises to keep something secret from the person's family.

---

## 2. Safety pre-scan prompt

Lightweight classifier call on each parent turn → returns `{severity: none|p0|p1|p2|p3, rationale}`.

- **P0 crisis** (self-harm/suicide) → companion responds with warmth + surfaces **988**, urges contacting a person now; `safety_flag` raised; admin alert; family per consent.
- **P1 acute medical** (chest pain, fall) → urge **911**/family now; flag + alerts.
- **P2 welfare** (persistent hopelessness, not eating, confusion, isolation) → gentle nudge to family/doctor; flag for admin review.
- **P3 abuse/exploitation** → surface resources; admin review; family per consent + judgment.

**Hard rule:** Kindly surfaces resources and flags humans. It never states it has contacted emergency services unless that is literally true.

---

## 3. Memory extraction prompt (async, post-turn)

Input: recent turns. Output: JSON array of candidate memories:
```json
[{"layer":"core|interest|episodic","key":"...","value":"...","sensitivity":"normal|sensitive|restricted","confidence":0.0}]
```
Rules: core/interest candidates enter as `proposed` (await parent/buyer confirmation). Episodic auto-stored with `decay_at`. Anything health/mood/risk → `sensitivity=restricted`, never surfaced to family verbatim. Low-confidence candidates discarded.

---

## 4. Conversation summary prompt (session end)

Produces `summary_text` (2–4 warm sentences, non-clinical) + coarse `mood_signal` (`warm|flat|low|null`). No diagnosis language. No restricted detail in shareable fields.

---

## Versioning & testing
- Formal sign-off status per prompt (reviewers, approval, hash-pinned to the exact
  reviewed text) is tracked in [PROMPT_SIGN_OFF.md](./PROMPT_SIGN_OFF.md), enforced
  by `test/promptSignOff.test.ts`.
- Every prompt is versioned (`v1`, `v1.1`…) and changes require AI Safety re-review.
- Red-team suites (must pass before merge to `dev`): **human-impersonation set**, **medical-claim set**, **crisis-handling set**, **credential-phishing set**, **emotional-manipulation / dependency set**, **elderspeak/tone set**. See [PROMPT_SIGN_OFF.md](./PROMPT_SIGN_OFF.md) for coverage detail per suite.
- Golden transcripts stored for regression on every prompt change.
