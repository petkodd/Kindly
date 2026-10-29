# AI companion for aging parents — web app (Alpha v0.1)

> For the moments you can’t be there.

A warm, voice-first AI companion that an adult child gives to an aging parent.
The child sets up the companion and seeds it with memories, the parent talks
with a kind, patient AI, and the family gets a respectful weekly summary.

> **Product name:** the final name is still an open founder decision (D1). The
> UI currently says “Dearly” and the repo says “Kindly”; this README says
> “the app”.

This repo holds the marketing website (SEO-ready, indexable) and the private
web app (noindex): Next.js 14 App Router, TypeScript, Tailwind, Postgres with
pgvector, deployed on Vercel.

---

## Quick start: clone to working demo (about 10 minutes, no paid keys)

You need **Node.js 18.18+** (20 or 22 recommended), **Docker Desktop** (or any
Docker with Compose v2), **git** and **openssl** (preinstalled on macOS/Linux).

1. **Clone and install**
   ```bash
   git clone <repo-url> kindly-app && cd kindly-app
   npm ci
   ```
2. **Create your local env file**
   ```bash
   cp .env.example .env.local
   ```
3. **Fill in three values** in `.env.local` (see [Secrets](#secrets) for why):
   ```bash
   # run each command and paste the output after the "="
   openssl rand -hex 32   # → SESSION_SECRET=
   openssl rand -hex 32   # → CRON_SECRET=
   # DEMO_PASSWORD= any password with 8+ characters, e.g. demo-pass-123
   ```
   Leave every `[PAID]` key empty. The app then uses simulated AI, voice and
   email, and shows a **“Demo mode: simulated AI & voice”** badge.
4. **Start Postgres** (Postgres 16 with pgvector and citext):
   ```bash
   docker compose up -d --wait
   ```
   Port 5432 already in use? Run `KINDLY_DB_PORT=5433 docker compose up -d --wait`
   and change `localhost:5432` to `localhost:5433` in `DATABASE_URL`.
5. **Create the tables and demo data**
   ```bash
   npm run db:seed
   ```
   This applies all migrations, then seeds the demo. It prints the logins and a
   **parent talk link**; keep that link for step 7. Safe to re-run any time: it
   resets the demo data and moves it into the current week. It refuses to run
   unless `DATABASE_URL` points at `localhost` or `127.0.0.1`.
6. **Run the app**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000/login and log in as **demo@kindly.test** with your
   `DEMO_PASSWORD`. You land in the app as the gift buyer for “Mom (demo)”.
7. **Talk as the parent.** Open the talk link from step 5 in a private window
   and press **Start talking**. Tap **Talk to Dearly**, say something, and tap it
   again to send. Without a microphone, or after **Type instead**, type a
   message and press **Send**. Replies come from the simulated AI (the
   simulated voice is silent: it returns no real audio).
8. **See the admin view.** Log out, log in as **admin@kindly.test** (same
   password) and open http://localhost:3000/admin: metrics, the open P2 safety
   flag and cost per voice minute.

Stuck? See [Troubleshooting](#troubleshooting).

### What the seed creates

| Item | Details |
|---|---|
| Organizer (gift buyer) | `demo@kindly.test`, password = `DEMO_PASSWORD` |
| Admin | `admin@kindly.test`, password = `DEMO_PASSWORD` |
| Parent | “Mom (demo)”: activated, buyer attestation + parent consent, active 14-day beta plan (no Stripe needed) |
| Memories | 8, across all layers (profile, core, interest, episodic, sensitive); 1 sensitive, 2 proposed for review |
| Conversations | 3 ended voice conversations this week, with turns, per-conversation summaries and usage-cost rows |
| Family | This week’s summary preview, 1 accepted summary recipient (`sibling@kindly.test`, never emailed) |
| Safety | 1 open P2 (welfare) flag |

All emails use the reserved `.test` domain, so nothing can reach a real inbox.

---

## Environment variables

Copy `.env.example` to `.env.local`. **Paid = yes** means the key comes from a
paid provider; none of them are needed locally.

| Name | Required | Paid | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | no | Postgres (pgvector + citext). The example value matches `docker-compose.yml`. |
| `PGSSL` | local: yes (`disable`) | no | `disable` for the local Docker database; empty for managed Postgres (verified TLS). |
| `SESSION_SECRET` | yes | no | Signs login session cookies. Without it nobody can log in. |
| `CRON_SECRET` | yes for jobs | no | Bearer secret for `/api/jobs/*` (Vercel Cron and `npm run cron:*`). |
| `DEMO_PASSWORD` | for `db:seed` | no | Password of the two seeded demo accounts. 8+ characters. |
| `DEMO_MODE` | no | no | `true` = always simulated AI/voice/email plus the demo badge, even with keys set. For demo deploys. |
| `NEXT_PUBLIC_SITE_URL` | prod: yes | no | Public URL for canonical, Open Graph and sitemap. |
| `APP_BASE_URL` | prod: yes | no | Base for absolute links back into the app (invites, emails). Local default `http://localhost:3000`. |
| `AI_API_KEY` | prod: yes* | **yes** | Anthropic key for the companion and summaries. |
| `AI_MODEL` | no | no | Model id for the companion (default: the signed `claude-sonnet-4-6`). |
| `TALK_LIMIT_PARENT_PER_10_MIN`, `TALK_LIMIT_PARENT_PER_DAY` | no | no | Talk turns per parent (defaults 30 per 10 minutes, 300 per day). |
| `TALK_LIMIT_IP_PER_10_MIN`, `TALK_LIMIT_IP_PER_DAY` | no | no | Talk turns per IP address (same defaults; raise for a facility where many residents share one IP). |
| `TALK_VOICE_MINUTES_PER_DAY` | no | no | Voice minutes per parent per 24 hours (default 60); typing still works after. |
| `DEEPGRAM_API_KEY` | prod: yes* | **yes** | Speech-to-text for voice turns. |
| `ELEVENLABS_API_KEY` | prod: yes* | **yes** | Text-to-speech for voice replies. |
| `ELEVENLABS_VOICE_ID` | no | no | ElevenLabs voice (default: Adam). |
| `EMAIL_API_KEY` | prod: yes* | **yes** | Resend key for summaries, invites and magic links. |
| `EMAIL_FROM` | prod: yes* | no | Sender address for Resend. |
| `STRIPE_SECRET_KEY` | for checkout | **yes** | Stripe API key. **Test mode only** outside production. |
| `STRIPE_WEBHOOK_SECRET` | for checkout | no | Signing secret for `/api/billing/webhook` (from `stripe listen` locally). |
| `STRIPE_PRICE_*` | for checkout | no | Stripe Price ids per plan; see comments in `.env.example`. |
| `FOUNDING_FAMILY_BETA_ENABLED` | no | no | `true` enables the invite-only founding beta activation. |
| `FOUNDING_FAMILY_BETA_DAYS` | no | no | Beta length in days (default 14). |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN` | no | **yes** (free tier) | Error tracking; idle when empty. |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | no | no | Source-map upload at build time only. |

\* **Production rule.** On the production deploy (`VERCEL_ENV=production`), a
missing AI, Deepgram, ElevenLabs or email key is a hard error when that client
is first used. The app never quietly swaps in a fake. The only way to run
production on fakes is `DEMO_MODE=true`, which also shows the demo badge.
Locally and on preview deploys, a missing key falls back to the simulated
client. Emails “sent” through the simulated client are recorded as
`simulated`, never `sent`.

### Secrets

| Secret | Generate with | Notes |
|---|---|---|
| `SESSION_SECRET` | `openssl rand -hex 32` | Changing it logs everyone out. Use a different value per environment. |
| `CRON_SECRET` | `openssl rand -hex 32` | Must match between Vercel and its cron calls. Locally, restart `npm run dev` after changing it. |

No openssl? `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
does the same. Never commit `.env.local`, and never paste secret values into
issues, PRs or chat. Refer to them by name.

---

## Local tools

| Command | What it does |
|---|---|
| `docker compose up -d --wait` | Start local Postgres 16 + pgvector + citext (data kept in a named volume). |
| `docker compose down` / `down -v` | Stop it / stop it **and delete** local data. |
| `npm run db:seed` | Apply migrations and (re)seed the demo. Local databases only. |
| `npm run db:migrate` | Apply migrations only. Reads `DATABASE_URL` from your shell, not `.env.local`. |
| `npm run admin:create -- <email> --confirm` | Make an existing user an admin (see below). |
| `npm run cron:weekly` | Run the weekly-summary job now: previews last full week (needs `npm run dev` running). |
| `npm run cron:purge` | Run the hard-delete purge job now (needs `npm run dev` running). |
| `npm run dev` | Dev server on http://localhost:3000. |
| `npm test` | Unit, route and component tests (vitest + in-memory Postgres). |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint. |
| `npm run check:prompt-signoffs` | Check that every AI prompt in use has its human sign-off. |

### Creating the first admin

Nothing in the app grants admin rights. On a fresh database (or a real
environment), sign up normally, then:

```bash
npm run admin:create -- you@example.com            # dry run: shows the DB host, changes nothing
npm run admin:create -- you@example.com --confirm  # promotes the user
```

It reads `DATABASE_URL` from your shell or `.env.local` and prints only the
database **host name**, so check that host before you add `--confirm`. Log out
and back in to get the admin session. The seeded `admin@kindly.test` is already
an admin.

### Running the cron jobs locally

Vercel Cron runs these on a schedule in production (`vercel.json`). Locally,
with `npm run dev` running in another terminal:

```bash
npm run cron:weekly   # builds the summary preview for the last full week, for every active parent
npm run cron:purge    # hard-deletes soft-deleted accounts and expired transcripts
```

Both call `http://localhost:3000/api/jobs/...` with your `CRON_SECRET`, exactly
as Vercel does, and print the JSON result.

### Optional: Stripe checkout with the Stripe CLI

The demo account already has a beta plan, so you only need this to test
checkout and webhooks. Use **test mode only**.

1. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and run `stripe login`.
2. In the Stripe dashboard (test mode), create the Products and Prices and put
   the test key (`sk_test_…` or a restricted `rk_test_…`) and the
   `STRIPE_PRICE_*` ids in `.env.local`.
3. Forward webhooks to your dev server:
   ```bash
   stripe listen --forward-to localhost:3000/api/billing/webhook
   ```
   Copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET` and restart `npm run dev`.
4. Pay with test card `4242 4242 4242 4242`, any future date, any CVC. Or replay
   events with `stripe trigger checkout.session.completed`.

---

## Tests

```bash
npm test                 # whole suite, about a minute; no database or keys needed
npx vitest run test/seed.test.ts      # one file
npm run test:watch       # watch mode
```

Tests run against an in-memory Postgres (pg-mem) built from the real migrations
in `db/migrations`, with the simulated AI, voice and email clients. Before a PR,
run `npm run typecheck && npm run lint && npm test`.

---

## 5-minute investor demo

Setup, before the meeting (2 minutes):

1. Run `npm run db:seed` so the demo data sits in this week, and copy the talk link it prints.
2. Run `npm run dev`. Open two windows: a normal one logged in as `demo@kindly.test` on
   **Family Summary**, and a private one with the parent talk link.
3. Check that the **“Demo mode: simulated AI & voice”** badge shows in the header.

Then walk through it:

1. **(0:00) The promise.** “Adult children can’t be there every day. This gives a
   parent someone kind to talk to, and gives the family peace of mind.” Point at
   the badge and say plainly that today’s replies and voice are simulated.
2. **(0:30) The gift setup.** In the organizer window, open **Parent Profile**.
   “Sarah set this up for her mom in a few minutes: who she is, how she likes to
   talk, and consent recorded before anything was activated.”
3. **(1:15) Memory the family controls.** Open **Memories**. Show the confirmed
   memories (grandchildren, favourite music, her late husband, handled as
   sensitive). Then show the two the companion **noticed** in conversation and
   press **Confirm** on one. “It only remembers what the family approves.”
4. **(2:15) The parent’s side.** Switch to the private window. Press **Start
   talking**. The companion first says it is an AI, never a person. Type
   “I picked tomatoes from the garden this morning” and press **Send**. It
   answers warmly and brings up something it remembers.
5. **(3:15) Peace of mind for the family.** Back in the organizer window, open
   **Family Summary**: this week’s respectful summary, with no transcript.
   Press **Send this week’s summary**. The app shows
   “Simulated … demo mode, no email was sent”.
6. **(4:00) Safety and unit economics.** Log in as `admin@kindly.test` and open
   `/admin`. Show the **open P2 welfare flag** (“skipped a meal”), which a person
   reviews, and **Cost & retention**, which shows what each voice minute costs us.
7. **(4:45) Close.** “Warm, honest that it’s an AI, never a replacement for
   family or doctors, and the family sees how Mom is doing every week.”

Reset afterwards with `npm run db:seed`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `db:seed` says “Refusing to seed: DATABASE_URL host is …” | Your `.env.local` points at a remote database. Use the Docker URL from `.env.example`. |
| `db:seed` says “Could not connect” | Run `docker compose up -d --wait` and check `docker compose ps` shows `healthy`. |
| `port is already allocated` on `docker compose up` | Use `KINDLY_DB_PORT=5433` (see quick start step 4). |
| Login does nothing or bounces back to /login | `SESSION_SECRET` is empty. Set it and restart `npm run dev`. |
| Talk link says “isn’t valid or has expired” | Each `db:seed` run issues a new link; use the latest one. |
| `cron:*` returns 401 | `CRON_SECRET` changed after `npm run dev` started. Restart the dev server. |
| A page errors with “… is not set. Production … never falls back” | You set `VERCEL_ENV=production` locally. Unset it, or set `DEMO_MODE=true`. |

---

## What’s in the box

```
src/
  app/
    (public)/        Marketing site: indexable, SSR/SSG (home, gift, how it works,
                     pricing, trust & privacy, senior living, blog, waitlist)
    (app)/app/       Private web app, noindex (onboarding, parent profile, memories,
                     talk, family summary, referrals, account)
    admin/           Internal dashboard (noindex)
    api/             Route handlers (auth, parents, talk, billing, jobs, admin, …)
  components/        Shared UI (DemoModeBadge, AppNav, SiteHeader, …)
  lib/               ai/, speech/, email/ (each with a simulated client), repos/,
                     jobs/, billing/, runtimeMode.ts (demo/production rules)
db/
  migrations/        Schema (pgvector + citext)
  migrate.mjs        Migration runner
  seed.mjs           Local demo seed (seed-lib.mjs holds the data and the localhost guard)
  docker-init/       Extensions for the local Docker database
scripts/             admin-create, cron, beta-invite, prompt sign-off tools
docs/                API plan, analytics events, prompt architecture
docker-compose.yml   Local Postgres 16 + pgvector
```

## Design system

Senior-first by default: large base type (about 19px), touch targets of 48px or
more, AA contrast, always-visible focus rings, reduced motion respected. Calm
sage and warm clay on a soft off-white. Tokens live in `tailwind.config.ts` and
`src/app/globals.css`.

## Deploying to Vercel

1. Import the GitHub repo into Vercel (framework: Next.js).
2. Add the env vars from the table above. On Production set every `prod: yes`
   value, including the paid keys, unless this is a demo deploy with
   `DEMO_MODE=true`.
3. Provision Postgres with pgvector and citext, and run `npm run db:migrate` once
   with that `DATABASE_URL` in your shell.
4. Sign up, then `npm run admin:create -- you@example.com --confirm` against
   that database.
5. Verify the domain in Google Search Console and submit `/sitemap.xml`.

`X-Robots-Tag: noindex, nofollow` is set on `/app/*` and `/admin` via both
`next.config.mjs` and `vercel.json`.

## Safety & privacy (non-negotiable)

- The companion always says it is an AI and never pretends to be human.
- It never replaces family, caregivers, doctors or emergency services.
- No medical claims (no diagnose, treat, cure or prevent).
- Consent-gated activation, data minimization, per-parent isolation, hard-delete path.
- Crisis handling surfaces 988/911 and flags humans, and never claims to have called for help.
- Simulated AI, voice and email are always labelled; production refuses to run on them silently.

See `docs/prompt_architecture_v1.md` for the enforced behavior rules and red-team suites.
