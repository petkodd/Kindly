# Repo hygiene: branches, `dev`, and the production environment

Audit date: 2026-10-19, against `origin/main` @ `11b8c6f` (#64). **Nothing has been deleted.** Section 5 is a script for Petko to run himself.

## How "merged" was checked

Every PR into `main` (and earlier into `dev`) was **squash-merged**, so `git branch --merged` says nothing, and plain `git cherry` only matches when a branch had a single commit. For each branch I used these checks:

1. **Squash check.** I built a synthetic commit that has the branch's tree on its merge-base, then ran `git cherry <target> <synthetic>`. A `-` result means the branch's whole diff already exists in the target as one commit. I matched patch-ids to name the PR.
2. **Diff check.** For branches where the squash check failed, I diffed the files the branch touched against `main`, and checked that any residual diff comes only from later work on `main` (rebrand, follow-ups), not from code that exists only on the branch.
3. **`dev` check.** `#32` (`a75dcaf`) has `origin/dev`'s tip tree **plus 565 / −12 lines**, and every file on `dev` exists on `main`. So `dev`'s 31 unique commits (`#3`–`#31`) reached `main` as the squash `#32` on 2026-07-07.

Reproduce one squash check: `syn=$(git commit-tree B^{tree} -p $(git merge-base origin/main B) -m s); git cherry origin/main $syn`.

## 1. Local branches

| Branch | Tip | Status | Evidence | Action |
|---|---|---|---|---|
| `docs/voice-selection` | `e3f6e28` | Squash-merged | patch-id = **#53** | delete |
| `feature/founding-family-beta` | `be700c2` | Squash-merged | patch-id = **#55** | delete |
| `feature/prompt-signoff-cli` | `0cb455d` | Squash-merged | #51 has the tooling. The only residual diff is the later Kindly→Dearly rebrand (#59) and `beta:invite`, both newer on `main`. Checked out in worktree `~/kindly-app-signoff`. | remove worktree, then delete |
| `feature/weekly-summary-verify` | `fbb2504` | Squash-merged | patch-id = **#54** | delete |
| `fix/security-hardening` | `c3b1522` | Content in `main` | Built on `dev`. Its own 3 fixes are on `main`: TLS verify in `db.ts` + `dbTls.test.ts`, consent-gate bypass, `CODE_LEN = 10` (commit `822d812`). The other 31 commits are `dev` history. | delete |
| `redesign/pricing-page` | `790b6e9` | **⚠ Has unique work. Do not delete yet.** | The pricing redesign is **#50**, but local commit `790b6e9` *"Add FAQ section: pricing page accordion, /faq page, footer link"* is **on no remote branch and not in `main`** (`main` has no FAQ files). The remote copy has a newer commit `68c346b` that is also in #50. `stash@{0}` was made on this branch. | push `790b6e9` as `feature/faq` first (script step 1), then delete |
| `feature/referral-program` | `a71b3fd` | **⚠ Unique, local only** | *"Apply referral rewards via Stripe balance credit on redemption"*: 21 files, +1473, including `src/lib/billing/referralReward.ts`, which is not on `main`. `src/lib/billing/index.ts` on `main` refers to it as a pending follow-up. | push as `feature/referral-stripe-credit` (step 1), keep |
| `feat/talk-voice-only` | `fded08d` | Not merged (decision **D9** = merge) | `fded08d` is **not yet on `origin/main`**. Chat 8 depends on it. | `git push origin feat/talk-voice-only:main` (Petko) |
| `chore/demo-mode` | `8676fd1` | Active (chat 1) | n/a | keep |
| `chore/deps-and-ci` | n/a | This PR | n/a | keep |

Stashes: `stash@{0}` (2026-07-28, "wip: weekly-summary delivery flow (4.4)"; 4.4 shipped as #54) and `stash@{1}` (2026-06-30, WIP on `dev`). Both are most likely obsolete. Check them with `git stash show -p stash@{N}` before you `git stash drop`. The script doesn't touch them.

## 2. Remote branches

### 2a. Empty scaffolds: no commits beyond the 2026-06-30 scaffold

All of these point at `c3754f7` (*"chore: Kindly Alpha v0.1 scaffold"*), or at the backend slice already in `main`. They were created from the project's planned branch list and never used.

`feature/blog-seo-content`, `feature/family-dashboard`, `feature/gift-onboarding`, `feature/landing-page`, `feature/parent-profile`, `feature/seo-foundation`, `feature/staff-dashboard`, `feature/voice-conversation` (all `c3754f7`); `feature/privacy-consent` (`7e55a25`, ancestor of `main`); `feature/weekly-summary` (`855dc35`, in `dev` history). **Delete.**

> These are names from the project branch plan. If you want to keep the names as placeholders, recreate them later from `main`. A scaffold branch 44 commits behind `main` is a trap: anyone who builds on it starts from July's code.

### 2b. Stale `dev`-era branches (last activity 2026-07-01 to 07-06)

Each one was squash-merged into `dev` (PR number from patch-id / subject match), and `dev` reached `main` via #32. All are 42 commits behind `main`.

| Branch | Into `dev` as | | Branch | Into `dev` as |
|---|---|---|---|---|
| `feature/weekly-summary-cron` | #3 | | `feature/frontend-onboarding` | #15 |
| `feature/ai-provider` | #4 | | `chore/cleanup-findings` | #16 |
| `feature/ai-companion-chat` | #5 | | `feature/frontend-family-summary` | #17 |
| `feature/memory-system` | #6 | | `feature/frontend-referrals` | #18 |
| `feature/safety-escalation` | #7 | | `feature/frontend-memories` | #19 |
| `feature/auth` | #8 | | `claude/amazing-roentgen-34d8c3` | #21 |
| `fix/dev-duplicate-getadminid` | #9 | | `chore/dedup-user-email-re` | #22 |
| `feature/referral-program` (remote, `a3edd0b`) | #10 | | `feature/frontend-parent-profile` | #23 |
| `chore/ci-security-seo` | #11 | | `feature/admin-overview` | #24 |
| `feature/user-profile` | #12 | | `feature/frontend-talk` | #25 |
| `feature/session-revocation` | #13 | | `refactor/parent-gate`, `refactor/shared-field-card` | #26 (0 lines not in `dev`) |
| `feature/frontend-auth` | #14 | | `refactor/shared-input-styles` | #27/#29 (0 lines not in `dev`) |
| `feature/talk-token-cookie` | #28 | | `feature/purge-hard-deletes` | #30 (0 lines not in `dev`) |
| `fix/security-hardening` | fixes in `822d812` | | `feature/frontend-shared-parent-picker` | see note |

Note on `feature/frontend-shared-parent-picker` (`a1ecf78`, one commit, *"extract shared ParentPicker + useParents + EMAIL_RE"*): the squash check against `dev` fails. But `main` has `ParentPicker`, `useParents` (with tests) and the shared `EMAIL_RE` (#21/#22), so the branch was superseded by those PRs. It is safe to delete. If you want to look first: `git diff origin/main origin/feature/frontend-shared-parent-picker -- src/components src/hooks`.

Also delete the local worktree `.claude/worktrees/amazing-roentgen-34d8c3` (detached at `280c36b`, which is `claude/amazing-roentgen-34d8c3`).

### 2c. Squash-merged into `main` (PR branches never deleted after merge)

| Branch | PR |
|---|---|
| `feature/day6-marketing-copy-analytics-sdk` | #37 |
| `feature/voice-talk-ui` | #40 |
| `redesign/pricing-page` (remote `68c346b`) | #50 |
| `feature/prompt-signoff-cli` | #51 (+ residual is newer `main` work) |
| `docs/voice-selection` | #53 |
| `feature/weekly-summary-verify` | #54 |
| `feature/founding-family-beta` | #55 |
| `fix/prompt-review-followups` | #56 |
| `chore/prod-hygiene` | #57 |
| `chore/sentry-instrumentation-client` | #58 |
| `rebrand/kindly-to-dearly` | #59 |
| `assets/dearly-og-image` | #60 |
| `feat/app-nav-and-post-login-redirect` | #61 |
| `fix/appnav-scroll-active-into-view` | #62 |
| `fix/pricing-page-matches-real-stripe-price` | #63 |
| `fix/secure-cookie-flag-local-testing` | #64 |

**Recommendation:** turn on *Settings → General → Pull Requests → "Automatically delete head branches"*, so this list doesn't grow again.

### 2d. Keep

`main`, `feat/talk-voice-only` (D9, until it is on `main`), and any branch an implementation chat pushes from now on.

## 3. `origin/dev` (decision D10)

**State:** `dev` is **31 commits ahead of `main` and 42 behind** (the audit brief said 42 ahead / 31 behind; I measured `git rev-list --left-right --count origin/main...origin/dev` → `42 31`). Its last commit is #31 on 2026-07-07. It holds **no code that isn't on `main`**: #32 is `dev`'s tree plus new work, and every file on `dev` exists on `main`. The 31 "ahead" commits are only the pre-squash history of #3–#31.

**Recommendation:** freeze it, then delete it.
1. This PR already drops `dev` from CI triggers (push and pull_request).
2. In GitHub, check that no open PR targets `dev`, and that the default branch is `main` (it is: `origin/HEAD → main`).
3. Tag it so the history stays one command away (`archive/dev-2026-07-07`), push the tag, then delete the branch (script step 4).
4. Mark D10 as DECIDED in `claude/kindly-decisions.md`. The workflow is now branch → PR → `main`, with `release/*` for release candidates.

Don't merge `dev` into `main`. Every change it holds is already there, and a merge would only produce a large, noisy conflict.

## 4. Production environment

The `migrate` job in `.github/workflows/ci.yml` runs **only on a push to `main`**, after `build` passes, with `environment: production` and a single-flight concurrency group. One-time setup in GitHub (Petko):

1. *Settings → Environments → New environment* → name it **`production`** (exact name).
2. **Required reviewers:** add Petko, plus the DevOps/Security owner when there is one. Turn on *"Prevent self-review"* once there are two reviewers.
3. **Deployment branches and tags:** *Selected branches* → `main` only.
4. **Move the secret:** create **environment** secret `PRODUCTION_DATABASE_URL` under `production`, then delete the old *repository* secret of the same name. Only the approved job can read an environment secret; any workflow on any branch can read a repository secret.
5. Optional: environment secret `PRODUCTION_DB_CA_CERT` (the PEM text) if the database uses a private CA, for example RDS. The job writes it to a temp file and sets `PGSSLROOTCERT`. Neon and Supabase don't need it.
6. Remove any `sslmode=` from `PRODUCTION_DATABASE_URL`. `db/migrate.mjs` strips it anyway (with a warning) and always verifies certificates.

Until step 1 exists, GitHub creates the environment automatically on the first run **without** reviewers. So do step 1 before this PR merges.

**Prompt sign-off gate:** the `prompt-signoffs` job **blocks** on pushes to `main` / `release/*` and on PRs into `release/*`. It is informational (warning only) on feature-branch PRs into `main`. Today no prompt is signed, so expect a **red `prompt-signoffs` check on `main` after merge** until the AI Safety, Gerontology and Privacy reviewers sign with `scripts/sign-prompt.mjs`. That is intended, and it doesn't block the build or the migration job. If you add branch protection, make `build` a required check now, and make `prompt-signoffs` required only on `release/*`.

## 5. Cleanup script (Petko runs it; review it first)

The script backs everything up first, then refuses to delete any branch whose tip has moved since this audit. Run it from the main checkout on your Mac, not from a worktree.

```bash
#!/usr/bin/env bash
# Kindly repo cleanup: audit of 2026-10-19 (docs/repo-hygiene.md).
set -euo pipefail
cd ~/kindly-app
git fetch origin --prune

# --- 0. Safety net: full backup of every ref, including the stashes -------
BACKUP=~/kindly-refs-backup-$(date +%Y%m%d-%H%M).bundle
git bundle create "$BACKUP" --all
echo "Backup written to $BACKUP (restore any branch: git fetch $BACKUP refs/heads/NAME:refs/heads/NAME)"

# Delete only if the branch still points where the audit saw it.
del_local()  { local b=$1 sha=$2; local cur; cur=$(git rev-parse --short=7 "refs/heads/$b" 2>/dev/null || echo none)
  if [ "$cur" = "$sha" ]; then git branch -D "$b"; else echo "SKIP local $b (now $cur, audit saw $sha)"; fi; }
del_remote() { local b=$1 sha=$2; local cur; cur=$(git rev-parse --short=7 "refs/remotes/origin/$b" 2>/dev/null || echo none)
  if [ "$cur" = "$sha" ]; then git push origin --delete "$b"; else echo "SKIP remote $b (now $cur, audit saw $sha)"; fi; }

# --- 1. Preserve local-only work under new remote names (nothing deleted) --
git push origin 790b6e9:refs/heads/feature/faq                     # FAQ section, not in main
git push origin a71b3fd:refs/heads/feature/referral-stripe-credit  # referral reward via Stripe credit

# --- 2. Local branches: squash-merged / content already in main ----------
[ -d ~/kindly-app-signoff ] && git worktree remove ~/kindly-app-signoff        # holds feature/prompt-signoff-cli
[ -d .claude/worktrees/amazing-roentgen-34d8c3 ] && git worktree remove .claude/worktrees/amazing-roentgen-34d8c3
del_local docs/voice-selection          e3f6e28
del_local feature/founding-family-beta  be700c2
del_local feature/prompt-signoff-cli    0cb455d
del_local feature/weekly-summary-verify fbb2504
del_local fix/security-hardening        c3b1522
del_local redesign/pricing-page         790b6e9   # safe only after step 1 pushed feature/faq
# feature/referral-program (local a71b3fd) is kept: it is now feature/referral-stripe-credit too.

# --- 3. Remote branches --------------------------------------------------
# 3a empty scaffolds
for b in feature/blog-seo-content feature/family-dashboard feature/gift-onboarding feature/landing-page \
         feature/parent-profile feature/seo-foundation feature/staff-dashboard feature/voice-conversation; do
  del_remote "$b" c3754f7; done
del_remote feature/privacy-consent 7e55a25
del_remote feature/weekly-summary  855dc35
# 3b dev-era, squash-merged into dev, dev -> main via #32
del_remote feature/weekly-summary-cron 332033f; del_remote feature/ai-provider cce9f15
del_remote feature/ai-companion-chat 7f3366c;   del_remote feature/memory-system bb4701d
del_remote feature/safety-escalation 5941abe;   del_remote feature/auth b11d2eb
del_remote fix/dev-duplicate-getadminid f87a218; del_remote feature/referral-program a3edd0b
del_remote chore/ci-security-seo 51bb46e;       del_remote feature/user-profile dda920a
del_remote feature/session-revocation 58a7484;  del_remote feature/frontend-auth 0760eea
del_remote feature/frontend-onboarding 6c2a7ff; del_remote chore/cleanup-findings 32abf8d
del_remote feature/frontend-family-summary e5c30dd; del_remote feature/frontend-referrals f182dc2
del_remote feature/frontend-memories fa6debd;   del_remote claude/amazing-roentgen-34d8c3 280c36b
del_remote chore/dedup-user-email-re 08a40c1;   del_remote feature/frontend-parent-profile 714c17b
del_remote feature/admin-overview e44277d;      del_remote feature/frontend-talk 24511e0
del_remote refactor/parent-gate 57c4bdd;        del_remote refactor/shared-field-card 9fd2763
del_remote refactor/shared-input-styles e753d67; del_remote feature/talk-token-cookie cea3f43
del_remote feature/purge-hard-deletes e445df8;  del_remote fix/security-hardening c3b1522
del_remote feature/frontend-shared-parent-picker a1ecf78
# 3c squash-merged into main (#37-#64)
del_remote feature/day6-marketing-copy-analytics-sdk 5e5ee3a; del_remote feature/voice-talk-ui cac4aae
del_remote redesign/pricing-page 68c346b;       del_remote feature/prompt-signoff-cli 0cb455d
del_remote docs/voice-selection e3f6e28;        del_remote feature/weekly-summary-verify fbb2504
del_remote feature/founding-family-beta be700c2; del_remote fix/prompt-review-followups 6ce9ee8
del_remote chore/prod-hygiene 9b594d3;          del_remote chore/sentry-instrumentation-client bcd4ab6
del_remote rebrand/kindly-to-dearly 9dbff75;    del_remote assets/dearly-og-image 0b47ad4
del_remote feat/app-nav-and-post-login-redirect 47cd829; del_remote fix/appnav-scroll-active-into-view 16f72ee
del_remote fix/pricing-page-matches-real-stripe-price 4a4546f; del_remote fix/secure-cookie-flag-local-testing 95ce260

# --- 4. dev (only after D10 is DECIDED and no open PR targets dev) --------
# git tag -a archive/dev-2026-07-07 cb37675 -m "dev branch, frozen; content reached main via #32"
# git push origin archive/dev-2026-07-07
# del_remote dev cb37675

git fetch origin --prune
git branch -a
```

Not in the script, on purpose:
- `git worktree prune`. Worktree paths differ between your Mac and Claude's linked-computer view, so pruning from the wrong side would drop live worktrees (`chore/demo-mode` and this one).
- `git stash drop` (see section 1).
- `feat/talk-voice-only`: push it to `main` per D9 first.
