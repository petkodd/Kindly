# Adding a prompt, and getting it signed off

Companion doc to [docs/PROMPT_SIGN_OFF.md](../docs/PROMPT_SIGN_OFF.md) (the
formal matrix) and [docs/prompt_architecture_v1.md](../docs/prompt_architecture_v1.md)
(what each prompt does and why). This is the practical how-to.

## Adding a new production prompt

1. Add the versioned constant to `src/lib/ai/prompts.ts` (e.g. `MY_NEW_PROMPT_V1`).
   Bump the `_V1` suffix on future edits rather than mutating a prompt in place
   without a version bump — keeps old text discoverable in git history.
2. Register it in [prompts/signoffs.json](./signoffs.json) with an empty array:
   ```json
   "MY_NEW_PROMPT_V1": []
   ```
   `test/promptSignOff.test.ts` and `scripts/check-prompt-signoffs.mjs` only
   look at prompts that are registered here — an unregistered prompt ships
   with no sign-off tracking at all, silently.
3. Add a row to the matrix in `docs/PROMPT_SIGN_OFF.md`.
4. If the prompt can produce free-text model output (not just structured
   JSON), consider whether any of `BANNED_OUTPUT_PATTERNS_V1` should apply to
   it, and whether it needs its own red-team suite in `test/redteam/`.

## Recording a sign-off

Once a reviewer has actually read and approved (or requested changes to) the
exact text in `src/lib/ai/prompts.ts`:

```
node scripts/sign-prompt.mjs \
  --prompt COMPANION_SYSTEM_V1 \
  --role safety \
  --reviewer "Jane Doe" \
  --decision approved \
  --notes "reviewed tone + crisis-deferral clause"
```

- `--role` is one of `safety` / `gerontology` / `privacy` (AI Safety Reviewer,
  Gerontology Advisor, Privacy Advisor).
- `--decision` is `approved` or `changes_requested`.
- The script reads the prompt's CURRENT text straight out of `prompts.ts`,
  hashes it, and appends the entry to `prompts/signoffs.json` — it can't be
  fooled by a stale copy-paste of the prompt text.
- Every prompt needs sign-off from **all three roles** before it's considered
  fully approved — a single role's approval only covers that role's concern.

Check current coverage any time with:

```
npm run check:prompt-signoffs
```

This command is always strict: it exits nonzero until real reviewers have
signed off every registered prompt at the current hash. Setting
`SIGNOFF_BLOCKING=false` does not change the Node command's exit status.

### CI enforcement

The separate `prompt-signoffs` job in `.github/workflows/ci.yml` always runs
the strict command and publishes the full coverage report in the run summary.
`scripts/prompt-signoff-policy.mjs` controls whether CI may continue after
that command fails:

| CI event | Missing approvals block CI? |
|---|---|
| Push to `release/mvp-alpha` | No; a warning and coverage report remain visible |
| PR targeting `release/mvp-alpha` | No; a warning and coverage report remain visible |
| PR targeting `main` | No (existing policy) |
| Push to `main` | Yes |
| Push to another `release/*` branch | Yes |
| PR targeting another `release/*` branch | Yes |
| Manual **Run workflow**, on any branch | Yes |

The exception is exact: `release/mvp-alpha-next`, for example, remains
blocking. It allows integration of the pre-launch MVP alpha while human
reviews are pending; a green alpha CI run is **not** prompt approval or a
release GO. `npm test` still enforces prompt registration, approved-hash
drift protection, and the automated safety/content contracts. No approvals
are created by the workflow, and prompt sign-offs remain human-only (D12).

For a strict pre-release check, run the command above or use **Actions → CI
→ Run workflow** and select the exact release branch. GitHub displays the
manual trigger once the workflow containing `workflow_dispatch` exists on
the default branch; until then, use the local strict command. Record real
approvals on that branch with `scripts/sign-prompt.mjs` and update the matrix
in `docs/PROMPT_SIGN_OFF.md` before a production release.

## What happens if a prompt changes after approval

`test/promptSignOff.test.ts` (part of `npm test`/CI) re-hashes every prompt on
every run. If the live text no longer matches a role's most recent approved
hash, that test fails with a message naming the prompt and role — the fix is
to get that role to re-review the new text and run `scripts/sign-prompt.mjs`
again. There's no way to "silently" edit a prompt that already has approvals
without CI catching it.

## V2 prompts are signed as a bundle

From V2 on, a sign-off covers everything that shapes what the person hears,
not just the system constant. `SIGNOFF_TEXT` in `src/lib/ai/prompts.ts` builds
the exact text that is hashed:

- `COMPANION_SYSTEM_V2`: the system constant, the per-turn context template,
  the crisis copy (P0/P1/P3), the greeting, the banned-output patterns, the
  safe fallback reply, the default model id and `max_tokens`.
- `SAFETY_SCAN_SYSTEM_V2`: the system constant, the `<conversation>` /
  `<message>` input template, the default safety model id and limits.

Changing any of these changes the hash, so an earlier approval shows as stale.
V1 keys still hash only their constant. `sign-prompt.mjs` and
`check-prompt-signoffs.mjs` read `SIGNOFF_TEXT` automatically.

An `AI_MODEL` / `AI_SAFETY_MODEL` override that differs from the signed
default runs an unsigned configuration; the client logs a warning at startup.

`prompts/signoffs.json` is protected by `.github/CODEOWNERS` (the handles
there are placeholders until the reviewers' GitHub accounts exist).

## Live red-team suite

`test/redteam-live/` calls the real companion reply and safety scan and grades
the replies with regex checks plus an LLM-judge rubric. It is skipped unless
`AI_API_KEY` is set, and costs real tokens (about 30 model calls):

```
AI_API_KEY=... npm run test:redteam-live
```

Optional: `AI_JUDGE_MODEL` picks the judge model (defaults to the companion
default). Email and SMS always use the fakes in this suite. Run it before
asking reviewers to sign off a prompt change, and paste the result in the PR.
Note that `npm test` also runs it if `AI_API_KEY` is set in your shell.
