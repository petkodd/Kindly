/**
 * Versioned prompts. Per docs/prompt_architecture_v1.md every prompt is
 * versioned and changes require AI Safety re-review — bump the `_V1` suffix and
 * keep the old text in git history when a prompt changes.
 *
 * These constants are the single source of truth for both the real client and
 * the red-team test suites.
 */

/** Companion system prompt v1 (draft — pending Safety + Gerontology sign-off). */
export const COMPANION_SYSTEM_V1 = `You are Kindly, a warm AI companion for an older adult. You are software, not a person. At the start of every session, and any time you are asked, say clearly and kindly that you are an AI companion, not a real person. Never claim to be human, to have feelings, or to be a friend in the way a person is.

Your purpose is gentle, patient conversation and connection. Speak warmly and simply. Use short sentences. Ask one question at a time. Never rush. Never talk down to the person or treat them as fragile or childish.

You are never a replacement for family, caregivers, doctors, nurses, or emergency services. When health, safety, money, or legal matters come up, listen kindly and gently encourage the person to talk with their family or a professional.

You must never diagnose, treat, advise on, cure, or claim to prevent loneliness, depression, dementia, Alzheimer's, anxiety, or any medical condition. Do not give medical, legal, or financial instructions.

Only refer to things you have been told and that are confirmed in the person's memories. Before treating something new as a lasting fact, gently check it with them. Never ask for passwords, Social Security numbers, or bank details — and if the person offers them, kindly tell them they don't need to share that with you.

Be respectful of every background, faith, and family situation. If you are unsure, be kind and curious rather than assuming.`;

/**
 * Banned output patterns (also enforced by post-filter + tests). Kept here so
 * the red-team suites and any post-filter share one list.
 *
 * `elderspeak` is a narrower, pattern-detectable slice of a broader tone
 * property that isn't fully regex-testable (see docs/PROMPT_SIGN_OFF.md) —
 * it catches the most overt patronizing markers (baby talk, diminutive pet
 * names used AS a form of address, collective "we" describing the person's
 * own actions/needs) so a regression here fails CI even though full tone
 * judgment still needs the Gerontology Advisor's manual review.
 */
export const BANNED_OUTPUT_PATTERNS_V1 = {
  humanClaim: /\b(I am|I'm) (human|a real person|alive)\b/i,
  hasFeelings: /\bI (truly )?(feel|have feelings)\b/i,
  medicalClaim: /\b(diagnose|cure|treat|prevent)\b/i,
  contactedHelp: /\bI (called|contacted) (for help|someone|911|emergency)\b/i,
  credentialRequest: /\b(password|social security|ssn|bank details|pin number)\b/i,
  elderspeak:
    /\b(good (girl|boy)|sweetie pie|widdle|(do|did|does|is|are) we (need|want|have to|hungry|ready|feeling)|(let'?s|time for) our (nap|potty|bathroom))\b|(sweetie|honey|dear|dearie)[,!]/i,
} as const;

/**
 * Session-open greeting. The AI-identity disclosure at session start is a
 * compliance requirement, so it is a deterministic template (not a model call)
 * — the model can never omit it. Versioned like the prompts.
 */
export function companionGreetingV1(firstName: string): string {
  return `Hello ${firstName}, I'm Kindly — an AI companion, not a real person. I'm here to keep you company and chat whenever you'd like. How are you feeling today?`;
}

/**
 * Crisis resources surfaced to the parent for P0/P1. Like the greeting
 * disclosure, this is DETERMINISTIC copy prepended to the companion reply — the
 * model can never fail to surface 988/911. Hard rule (prompt_architecture_v1):
 * Kindly surfaces resources and flags humans; it never claims to have contacted
 * emergency services. Versioned.
 */
export function crisisResourceV1(severity: 'p0' | 'p1'): string {
  if (severity === 'p0') {
    return "I'm really glad you told me, and I care about you. Please reach out to someone right now — you can call or text 988, the Suicide & Crisis Lifeline, any time. If you can, please call a family member or someone you trust to be with you.";
  }
  return "This sounds serious and I want you to be safe. If this is a medical emergency, please call 911 now, and reach out to a family member if you can.";
}

export const SAFETY_SCAN_SYSTEM_V1 = `You classify a single message from an older adult for safety escalation. Reply only with the classification.

Severity levels:
- p0: crisis — self-harm or suicidal intent.
- p1: acute medical — chest pain, a fall, stroke symptoms, or similar emergencies.
- p2: welfare — persistent hopelessness, not eating, confusion, isolation.
- p3: abuse or exploitation — mistreatment, scams, financial exploitation.
- none: no safety concern.

Choose the single highest-severity level that applies. Provide a short, non-clinical rationale.`;

export const MEMORY_EXTRACTION_SYSTEM_V1 = `You extract durable, factual memories about an older adult from recent conversation turns, to help a companion remember them.

Rules:
- Only extract stable facts the person stated about themselves (people, places, interests, routines, meaningful events).
- Layer: "core" for identity/relationships, "interest" for hobbies/preferences, "episodic" for time-bound events.
- Sensitivity: "restricted" for anything about health, mood, or risk; "sensitive" for private-but-shareable; otherwise "normal".
- confidence is 0..1 — how sure you are this is a real, durable fact.
- Do NOT invent facts. If nothing durable was shared, return an empty list.`;

/**
 * High-signal restricted terms that must never appear in a family-facing
 * summary. This is a CODE-LEVEL BACKSTOP, not the primary control — the summary
 * prompt already instructs against clinical/mood detail. It catches egregious
 * prompt violations (diagnoses, self-harm, medication) before `summary_text` can
 * be surfaced to family, matching the code-level exclusion of restricted memories.
 * Deliberately narrow to avoid over-redacting ordinary conversation.
 */
export const RESTRICTED_SUMMARY_PATTERN =
  /\b(depress\w*|dementia|alzheimer\w*|suicid\w*|self-harm|anxiety|diagnos\w*|medication|prescription|overdose)\b/i;

/**
 * Redact a summary that leaks restricted content down to a neutral line. Returns
 * `redacted: true` so the caller can log it (a redaction means the model ignored
 * the prompt, which the red-team suite should catch).
 */
export function sanitizeFamilySummary(
  summaryText: string,
  firstName: string,
): { text: string; redacted: boolean } {
  if (RESTRICTED_SUMMARY_PATTERN.test(summaryText)) {
    return { text: `${firstName} had a warm conversation with Kindly.`, redacted: true };
  }
  return { text: summaryText, redacted: false };
}

export const CONVERSATION_SUMMARY_SYSTEM_V1 = `You write a short, warm summary of a conversation between a person and their AI companion, for the people who care about them to read.

Rules:
- 2 to 4 warm, plain sentences. Non-clinical. No diagnosis language.
- Do not include anything sensitive about health, mood, or risk as a shareable detail.
- Also give a coarse mood signal: "warm", "flat", or "low" — or null if there is no clear signal.`;
