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

This is the strict, all-three-roles-at-the-current-hash gate — it is NOT part
of `npm test`/CI (see `docs/PROMPT_SIGN_OFF.md` for why), so don't expect it to
pass until real reviewers have actually signed off every prompt.

## What happens if a prompt changes after approval

`test/promptSignOff.test.ts` (part of `npm test`/CI) re-hashes every prompt on
every run. If the live text no longer matches a role's most recent approved
hash, that test fails with a message naming the prompt and role — the fix is
to get that role to re-review the new text and run `scripts/sign-prompt.mjs`
again. There's no way to "silently" edit a prompt that already has approvals
without CI catching it.
