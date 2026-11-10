# SEO queue: orchestrator protocol for chats 21a … 22b, 20r, 21z

Source: `docs/seo-tasks-2026-11-10.md` (the SEO review, findings SEO-1 … SEO-15).
Design: project doc `claude/kindly-seo-orchestrator.md`.

Three scheduled sessions take turns every hour (Europe/Sofia):

| Minute | Session | Job |
|---|---|---|
| :55 | **SEO orchestrator** | Releases the next SEO chat as a tracking issue (`ap:todo`) when its turn comes. Never writes code. |
| :15 | Autopilot developer | Picks the `ap:todo` issue and implements `chats/<id>.md` (README "Developer run"). |
| :47 | Autopilot reviewer | Reviews and merges into `release/mvp-alpha` (README "Reviewer run"). |

The orchestrator runs 20 minutes before the developer, so the next task is ready when the developer starts.

## Queue (strict order, one at a time)

| # | Chat | Title | Branch | Findings | Needs `ap:done` first |
|---|---|---|---|---|---|
| 1 | 21a | SEO guard, regression tests, canonical host | `feature/seo-foundation-guard` | SEO-1, SEO-11, SEO-2 | — |
| 2 | 21b | Indexability: lang, robots, noindex thin/draft pages | `feature/seo-indexability` | SEO-5, SEO-13, SEO-4 | 21a |
| 3 | 21c | Keywords in titles/H1s + internal links | `feature/seo-keywords` | SEO-3, SEO-10 | 21b |
| 4 | 21d | Structured data | `feature/seo-structured-data` | SEO-6 | 21c |
| 5 | 21e | Self-hosted fonts + per-page share images | `feature/seo-fonts-og` | SEO-8, SEO-7 | 21c |
| 6 | 21f | Performance + Core Web Vitals field data | `feature/seo-performance` | SEO-9, SEO-12 | 21e |
| 7 | 21g | Blog route and tooling | `feature/seo-blog-route` | SEO-14 | 21d, 21e |
| 8 | 22a | Use-case pages /family-updates, /ai-companion-for-elderly | `feature/blog-seo-content-pages` | SEO-15 (part) | 21g |
| 9 | 22b | 3 launch articles + publish /blog | `feature/blog-seo-content` | SEO-15 (rest) | 22a |
| 10 | 20r | Independent SEO re-review (read-only report) | `seo/review-<YYYY-MM-DD>` | all | 22b |
| 11 | 21z | Fixes from the re-review (**only if** 20r found CRITICAL/HIGH) | `fix/seo-review` | from 20r | 20r |

Why this order: SEO-1 first (every canonical depends on it); SEO-11 tests right after, so every later chat runs against the safety net; indexability before copy; keywords before links, breadcrumbs and share images (they use the final headlines); fonts before OG images (`next/og` needs the local font files); the blog route reuses breadcrumbs (21d), OG images (21e) and the tests (21a); content only after the blog route exists; an independent check at the end.

## Orchestrator run (every hour at :55)

1. Clone the repo, check out `origin/release/mvp-alpha`, read `docs/autopilot/README.md` and this file.
2. List autopilot issues (REST: `gh api "repos/petkodd/Kindly/issues?labels=autopilot&state=all&per_page=100"`). SEO chats carry the extra label `seo` and the title `Autopilot: Chat <id> — <title>`.
3. **Something is running → do nothing.** If any autopilot issue (SEO or not) is `ap:todo`, `ap:in-progress`, `ap:in-review`, `ap:reviewing` or `ap:changes-requested`, end with one line ("waiting: chat X is <state>"). One chat at a time keeps the order.
   - Exception, health check only: if that issue is an SEO chat and its latest comment or commit is older than 12 hours, comment once `orchestrator: no progress for 12 h — developer/reviewer, please resume from the branch` (skip if that comment already exists). Do not change labels.
4. **An SEO chat is `ap:blocked` → do nothing** except make sure its last comment says exactly what Petko must do. End. (Other chats' `ap:blocked`, e.g. #80, don't stop the queue.)
5. **Release the next chat.** Take the first row of the queue that has no tracking issue yet. Check that every chat in "Needs `ap:done` first" has its issue closed as `ap:done`. Then:
   - for 21z only: read the merged 20r report (`docs/seo-review-*.md`, newest). If it has no CRITICAL or HIGH finding, don't create 21z: go to step 6.
   - create the issue (REST `POST /issues`): title `Autopilot: Chat <id> — <title>`, labels `autopilot`, `seo`, `ap:todo`, body:
     ```
     Task: docs/autopilot/chats/<id>.md (on release/mvp-alpha)
     Branch: <branch> from origin/release/mvp-alpha
     Findings: <SEO-n list> — details in docs/seo-tasks-2026-11-10.md
     Depends on: <issue links, all ap:done>
     Reviewers: <REVIEWERS line from the chat file>
     Released by the SEO orchestrator <ISO time>. Queue: docs/autopilot/seo-queue.md
     ```
   - end with one line ("released chat <id> as #<n>").
6. **Queue finished** (20r done, and 21z done or not needed): if no issue titled `SEO autopilot: run summary` exists, create it (labels: `seo` only) with: one row per chat (issue, PR, merged commit, rounds of review), anything DEFERRED in the PR bodies with reasons, the open human tasks (SEO-H1 … SEO-H5, SEO-H4 wording approval, Gerontology Advisor review of `/blog/lonely-aging-parent`, "Reviewed by" names, merge `release/mvp-alpha` → `main`). Then disable the scheduled task "Dearly SEO orchestrator" (`list_triggers` → `update_trigger enabled=false`) if the tools exist. Do NOT disable the developer or reviewer tasks unless the README says so.

## Orchestrator hard rules

- Never edits code, never pushes, never opens or merges PRs, never changes labels of an issue someone else is working on. Its only writes are: creating SEO tracking issues, health-check comments, the run-summary issue, disabling itself.
- Never releases two chats at once and never skips the dependency check.
- Never touches `main`, production, secrets or prompt sign-offs.
- If the queue and reality disagree (e.g. a chat file is missing on `release/mvp-alpha`, or an issue for a later chat already exists), don't guess: create no issue, open one issue `SEO orchestrator: needs Petko` (label `seo`) describing the mismatch, and end. Don't open a second one while it is open.
