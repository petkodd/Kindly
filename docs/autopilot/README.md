# Autopilot: AI developer + AI reviewer for chats 9–14

Decision D12 (2026-10-30, Petko): the remaining work-plan chats run without
Petko. Two scheduled Claude sessions take turns:

- **Developer:** implements one chat at a time on its own branch and opens a PR
  into `release/mvp-alpha`.
- **Reviewer:** a separate session with fresh context. It reviews that PR
  against the chat's acceptance criteria and the project's reviewer roles,
  fixes small issues, and squash-merges into `release/mvp-alpha`.

**`main` is never touched.** Petko does the one final merge
`release/mvp-alpha` → `main` after chat 14 says GO.

Every session starts cold. Everything it needs is in this folder:

| File | What |
|---|---|
| `README.md` | this protocol (read fully, every run) |
| `working-agreement.md` | rules for any code change |
| `decisions.md` | founder decisions D1–D12 |
| `chats/NN.md` | the task prompt for chat NN |
| `../../scripts/autopilot/setup-local-db.sh` | throwaway local Postgres for migrations, seed and browser checks |

## Order and dependencies

Run strictly one chat at a time, in this order:

| Order | Chat | Needs merged into `release/mvp-alpha` first |
|---|---|---|
| 1 | 09 Parent consent & summary privacy | — (3, 4, 8 already in main) |
| 2 | 10 Buyer funnel & account | — (6, 7 already in main) |
| 3 | 11 Referral credit | — (7 already in main) |
| 4 | 12 Accessibility & design system | 10, 11 |
| 5 | 13 Brand, copy, SEO & pricing | 9, 12 |
| 6 | 14 Independent release verification | 9–13 |

## State lives in GitHub issues

Each chat has one tracking issue in `petkodd/Kindly`, titled
`Autopilot: Chat NN — …` and labelled `autopilot`. Its state is one label:

| Label | Meaning | Who acts next |
|---|---|---|
| `ap:todo` | not started | developer |
| `ap:in-progress` | a developer session is working on it | (that session) |
| `ap:in-review` | PR open, ready for review | reviewer |
| `ap:reviewing` | a reviewer session is working on it | (that session) |
| `ap:changes-requested` | reviewer sent it back | developer |
| `ap:done` | PR merged into `release/mvp-alpha`, issue closed | — |
| `ap:blocked` | needs Petko (comment says exactly what) | Petko |

**Locks.** Before working on an issue, set its label to `ap:in-progress` (or
`ap:reviewing`) and post a comment `lock: <role> <ISO time>`. A lock older
than **6 hours** with no newer comment or commit is stale: the previous
session died or ran out of usage. Take it over and continue from the branch.

**Use the REST API only** (`gh api …`). GraphQL is unavailable in these
sessions, so `gh pr create`/`gh pr merge`/`gh issue edit` may fail. Examples:

```bash
R=repos/petkodd/Kindly
gh api "$R/issues?labels=autopilot&state=all&per_page=50" --jq '.[] | [.number,.title,(.labels|map(.name)|join(","))] | @tsv'
gh api -X PUT "$R/issues/$N/labels" -f 'labels[]=autopilot' -f 'labels[]=ap:in-progress'
gh api "$R/issues/$N/comments" -f body="lock: developer $(date -u +%FT%TZ)"
gh api "$R/pulls" -f title="Chat 9: …" -f head="$BRANCH" -f base=release/mvp-alpha -F body=@pr.md
gh api "$R/commits/$SHA/check-runs" --jq '.check_runs[] | [.name,.status,.conclusion] | @tsv'
gh api -X PUT "$R/pulls/$PR/merge" -f merge_method=squash -f commit_title="…"
```

## Developer run

1. Read this README, `working-agreement.md` and `decisions.md`.
2. List the tracking issues. Pick work in this priority:
   1. an issue in `ap:changes-requested` (address the reviewer's comment on its PR);
   2. an `ap:in-progress` issue with a stale lock (resume its branch);
   3. the first `ap:todo` issue in the order above whose dependencies are `ap:done`.

   If something is `ap:in-progress` (fresh lock), `ap:in-review` or
   `ap:reviewing`, **do nothing and end** (one chat at a time). If every issue
   is `ap:done`, end.
3. Lock it. Branch from fresh `origin/release/mvp-alpha` using the branch name in
   `chats/NN.md` (chat 11 starts from `origin/autopilot/referral-local-a71b3fd`).
   Rebase onto `release/mvp-alpha` if resuming.
4. Implement `chats/NN.md` completely, following `working-agreement.md`.
   **Push WIP commits to the branch at least every hour**, so a later run can
   resume. Keep the lock fresh with a short progress comment at each push.
5. Before handing over: `npm run typecheck && npm run lint && npm test` green,
   `npm run build` passes, migrations applied on the local DB
   (`scripts/autopilot/setup-local-db.sh`, then `npm run db:migrate` and
   `npm run db:seed` with that URL in `.env.local`), and the browser checks the
   chat asks for (Playwright + headless Chromium are pre-installed; save
   screenshots under `docs/autopilot/evidence/chat-NN/` on the branch).
6. Open the PR into `release/mvp-alpha` with the PR template from
   `working-agreement.md`. Title `Chat NN: …`. Mention the tracking issue as
   `Tracking: #<issue>` (not `Closes`; the reviewer closes it). Set the issue
   to `ap:in-review` and comment the PR link.
7. If you are blocked by something only Petko can do, set `ap:blocked` and
   comment what, exactly, he must do. Then end.

## Reviewer run

1. Read this README, `working-agreement.md`, `decisions.md` and the chat's
   `chats/NN.md`. **You did not write this code. Review it as an outsider.**
2. Find the issue in `ap:in-review` (or `ap:reviewing` with a stale lock). If
   none, end. Lock it as `ap:reviewing`.
3. Check out the PR branch, rebase onto `origin/release/mvp-alpha` if behind,
   then review against:
   - every acceptance criterion and task in `chats/NN.md`, ticked with evidence;
   - the chat's listed REVIEWERS: review from each role's point of view
     (privacy, safety, security, seniors' UX, SEO…) and write one line per role;
   - the working agreement (scope, file ownership, tests for every behaviour
     change, no secrets, no live keys, no prompt edited in place, no AI sign-off).
4. Run `npm run typecheck && npm run lint && npm test && npm run build` yourself,
   apply migrations on a fresh local DB, and repeat the key browser checks.
5. Small problems (bugs, missing tests, copy, a11y, lint): fix them yourself on
   the PR branch, with tests, and push. Up to **3 review rounds** per chat.
   Big problems (wrong approach, missing tasks, unsafe behaviour): post a PR
   review comment listing them precisely, set `ap:changes-requested`, end.
   After 3 rounds still failing: set `ap:blocked` with a summary for Petko.
6. **Merge rule.** Merge only when ALL hold:
   - the CI `build` job is green on the PR head;
   - every acceptance criterion is met (or explicitly impossible in this
     environment, explained in the PR, e.g. a live key);
   - no CRITICAL/HIGH issue left open.

   The `prompt-signoffs` job is **expected to fail** on PRs into `release/*`
   until human reviewers sign prompts. That is a release gate for Petko, not a
   reason to hold the PR. Never sign prompts and never weaken that check.
7. Merge by squash into `release/mvp-alpha` (REST, `merge_method=squash`). Post
   the review summary on the PR (roles, checks, what you fixed). Set the issue
   `ap:done`, close it. If the developer trigger can be fired from this session
   (`fire_trigger`), fire it so the next chat starts right away.

## Hard rules for both roles

- Never push to, merge into, or open PRs against `main`. Never deploy. Never
  run production migrations. Never connect to any DB except the local one from
  `setup-local-db.sh`.
- No live keys. Stripe test mode only, mocked in tests. Never print secrets.
- Never sign prompts (`scripts/sign-prompt.mjs`) or edit `prompts/signoffs.json`
  approvals. Never weaken CI gates.
- Stay in the chat's scope. Out-of-scope findings go under "Follow-ups".
- Chat 14 is read-only except its report (see `chats/14.md`). When chat 14 is
  done, post its verdict on its issue, then end. Petko decides the final merge.
- When all six issues are `ap:done`, the developer run ends without doing
  anything; if the session can update triggers, disable both autopilot triggers.
