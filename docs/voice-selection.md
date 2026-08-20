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
