# ElevenLabs voice selection

**Selected voice:** Bella — `EXAVITQu4vr4xnSDxMaL` (default in [src/lib/speech/providers.ts](../src/lib/speech/providers.ts), configured via `ELEVENLABS_VOICE_ID`).

## Constraint that shaped this decision

The ElevenLabs account backing `ELEVENLABS_API_KEY` is on the **free plan**, and free-plan
keys cannot use ElevenLabs' voice *library* over the API at all — only a small set of legacy
"premade" voices remain callable. This was confirmed with live requests (see
`scripts/verify-speech-providers.mjs` output and the ad-hoc check below), not assumed:

| Voice | Voice ID | API-accessible on this key? |
|---|---|---|
| Adam | `pNInz6obpgDQGcFmaJgB` | Yes |
| Bella | `EXAVITQu4vr4xnSDxMaL` | Yes |
| Antoni | `ErXwobaYiN019PkySvjV` | Yes |
| Arnold | `VR6AewLTigWG4xSOukaG` | Yes |
| Elli | `MF3mGyEYCl7XYWbV9V6O` | No — `402 paid_plan_required` |
| Josh | `TxGEqnHWrfWFTfGW9XjX` | No — `402 paid_plan_required` |
| Sam | `yoZ06aMxZJJ28mfd3POQ` | No — `402 paid_plan_required` |
| Rachel | `21m00Tcm4TlvDq8ikWAM` | No — `402 paid_plan_required` |
| Domi | `AZnzlk1XvdnrDgyD2WGd` | No — `404 not found` (retired) |

So the real shortlist for this app is four voices, not an open catalog. The API key also lacks
the `voices_read` permission (calls to `/v2/voices` return `missing_permissions`), which is
consistent with — and supports — the scope-hardening requirement below, but means voice
metadata (ElevenLabs' own gender/age/accent labels) can't be pulled programmatically either.

## What was actually compared

A sample line ("Hello, it is so good to talk with you today. How has your morning been so
far?") was synthesized through all four accessible voices with the app's production TTS
settings (`eleven_multilingual_v2`, `stability=0.6`, `similarity_boost=0.75`) using
`scripts/verify-speech-providers.mjs`'s underlying call path. Output saved to
`scripts/output/voice-sample-{adam,bella,antoni,arnold}.mp3` (gitignored, not committed —
regenerate locally with real keys if needed).

**Important limitation:** the actual judgment of warmth, pacing, and comprehensibility for
older listeners requires a human to listen — that assessment has not been done yet. Bella was
carried over from the code fix in #49 (which moved off Adam, ElevenLabs' male default, because
it read as flat/robotic for a companion product) rather than from a documented four-way
listening comparison. Treat "Bella selected" as **provisional** until a human reviewer
(UX Researcher for Seniors role in the task ticket) has actually listened to all four samples
and signed off, or confirmed Bella against Antoni/Arnold specifically.

## Rejected alternatives and why

- **Adam** (`pNInz6obpgDQGcFmaJgB`) — original default; rejected in #49 for sounding flat/robotic,
  not warm, for a senior-facing companion.
- **Elli, Josh, Sam, Rachel, Domi** — not usable: blocked by the free-plan API restriction or
  retired. Not evaluated because they're not callable with the current key/plan regardless of
  quality.

## Open items for next cycle

1. A human needs to actually listen to the four saved samples (or regenerate them) and confirm
   Bella vs. Antoni vs. Arnold for warmth/clarity — this doc currently documents *availability*,
   not a listening verdict.
2. If a wider voice selection is wanted, the ElevenLabs plan needs to be upgraded (free plan
   blocks the whole library over the API) — that's a billing decision, not something scoped
   here.
3. ElevenLabs dashboard scope confirmation (key restricted to Text-to-Speech only, no
   billing/voice-cloning) has not been verified in this cycle — requires logging into the
   ElevenLabs dashboard directly, which needs to be done by someone with account access.

## Vendor data handling

Added in chat 9 (parent consent & summary privacy). This lists what each vendor
receives from Dearly, what we know about retention, and the opt-outs we use.
**The agreement status has not been verified against our actual accounts.**
Every "TODO (Petko)" below needs someone with account access to check the
signed terms or dashboard settings and update this table.

| Vendor | Used for | Data sent | Retention (vendor side) | Opt-outs we use | Agreement status |
|---|---|---|---|---|---|
| Deepgram | Speech-to-text (Nova-2) | The parent's recorded audio for one turn, the language code | Per Deepgram's published terms, audio is not stored after processing unless the customer enables storage or takes part in the Model Improvement Program (MIP) | `mip_opt_out=true` on every `/v1/listen` request (`src/lib/speech/providers.ts`), so audio is never used for model training | TODO (Petko): confirm the account's terms (standard vs. enterprise), that no "store audio"/logging feature is enabled in the console, and whether a DPA is signed |
| ElevenLabs | Text-to-speech | The companion's reply text (never the parent's audio), the voice id | Per ElevenLabs' published terms, request text may be retained for abuse monitoring; zero-retention mode is an enterprise feature | None at the API level today (zero-retention mode is not available on our plan) | TODO (Petko): confirm the plan's retention terms, whether "use my data to improve models" can be disabled for the account, and whether a DPA is signed |
| Anthropic | Companion replies, safety scan, memory extraction, conversation summaries | Conversation text, the parent profile and approved memories in the prompt | Per Anthropic's commercial API terms, API inputs/outputs are not used for training and are kept for a limited period for trust and safety | Commercial API (no training on inputs by default) | TODO (Petko): confirm the account is on the commercial terms and whether a DPA/zero-retention addendum applies |

Our own retention: transcripts are deleted after 30 days, and deleted accounts
and profiles are purged 30 days after soft-delete (`src/lib/jobs/purge.ts`).
Audio is never stored by Dearly: it is sent to Deepgram for one transcription
and discarded.
