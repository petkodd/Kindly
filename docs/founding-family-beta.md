# Founding Family Beta

A 14-day, card-free entitlement for the first 10 invited US families, gated
on a one-time invite token. It replaces the Step 5 billing screen with a
"Join the Founding Family Beta" CTA for an invited, authenticated user whose
email matches a valid invite — everyone else keeps the existing Stripe trial
flow unchanged. No Stripe customer, checkout session, subscription, or charge
is ever created for a beta grant.

See also: [db/migrations/0013_founding_family_beta.sql](../db/migrations/0013_founding_family_beta.sql),
[src/lib/foundingBeta.ts](../src/lib/foundingBeta.ts),
[src/lib/repos/betaInvite.ts](../src/lib/repos/betaInvite.ts),
[src/app/api/billing/beta/activate/route.ts](../src/app/api/billing/beta/activate/route.ts).

## 1. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `FOUNDING_FAMILY_BETA_ENABLED` | to enable | Must be the exact string `true`. Any other value (including unset) disables the activation endpoint (503), regardless of invite validity. |
| `FOUNDING_FAMILY_BETA_DAYS` | no | Bounded positive integer, 1–365. Unset or invalid falls back to `14`. |

Both are read centrally by `src/lib/foundingBeta.ts` — nothing else in the
codebase reads them directly. See `.env.example` for the same documentation
inline.

## 2. Creating a beta invitation

Use the operator CLI script (direct DB connection, same pattern as
`db/migrate.mjs` — no running server needed):

```bash
DATABASE_URL=postgres://... node scripts/beta-invite.mjs create family@example.com
```

or via the npm alias:

```bash
npm run beta:invite -- create family@example.com
```

This prints the invite id, its expiry, and the **raw invite link exactly
once** — e.g. `https://www.dearlyhere.com/app/onboarding?invite=<token>`.
Only a SHA-256 hash of the token is stored; if the link is lost, create a new
invite for the same email rather than trying to recover it.

Send the link to the family directly (email/text) — do not post it anywhere
that gets logged, indexed, or analytics-tracked. The token is removed from
the visible URL by the onboarding wizard as soon as it's captured client-side.

### Creating the first 10 invites

Run the `create` command once per family, e.g.:

```bash
for email in family1@example.com family2@example.com ...; do
  npm run beta:invite -- create "$email"
done
```

Copy each printed link out immediately — the terminal output is the only
place the raw token is ever shown.

## 3. Revoking an invitation

```bash
npm run beta:invite -- revoke <invite-id>
```

Only affects an invite still in `pending` status (a no-op, not an error, on
an already-redeemed/expired/revoked one — it cannot un-redeem a grant that
already happened). Find the id via `npm run beta:invite -- list`.

## 4. Identifying an active or expired beta entitlement

- `npm run beta:invite -- list` shows every invite's status
  (`pending`/`redeemed`/`expired`/`revoked`), expiry, and redemption time.
- The entitlement itself lives in `subscriptions` (not a separate table):
  `status = 'beta'`, `current_period_end` is the beta's end date
  (`beta_ends_at`), `created_at` is its start (`beta_started_at`), and
  `stripe_customer_id`/`stripe_sub_id`/`billing_interval` are all `NULL`.
- `subscriptionRepo.isBillingCurrent(parentId)` is the single source of
  truth for "is this parent's access active right now" — it treats a `beta`
  row as current only while `current_period_end` is in the future, with no
  grace period. This is the same gate `GET /api/parents/:id/subscription`
  and the talk-session open gate (`conversationRepo.openSession`) already use,
  so no other code needed to change for beta access to work end-to-end.
- The parent-profile page's Billing section shows "Founding Family Beta ·
  ends <date>" while active, and "Your Founding Family Beta has ended…" once
  it lapses.

```sql
-- Quick manual check
SELECT parent_id, status, current_period_end, beta_invite_id
FROM subscriptions
WHERE status = 'beta'
ORDER BY created_at DESC;
```

## 5. Testing locally

1. Add to `.env.local`:
   ```
   FOUNDING_FAMILY_BETA_ENABLED=true
   FOUNDING_FAMILY_BETA_DAYS=14
   ```
2. Apply the migration: `npm run db:migrate`.
3. Create an invite for the email you'll sign up with:
   `npm run beta:invite -- create you@example.com`.
4. Sign up / log in as that email, start onboarding, and open the printed
   `?invite=...` link (or paste the token onto your own onboarding URL).
5. At Step 5 you should see "Join the Founding Family Beta" instead of the
   Stripe trial screen. Clicking "Continue with free beta" should advance to
   Step 6 with no Stripe redirect.
6. Run the automated suite: `npm test` (or narrow to the new files —
   `npx vitest run test/foundingBeta.test.ts test/betaInvite.test.ts
   test/subscription.test.ts test/routes/betaActivate.route.test.ts
   test/OnboardingFoundingBeta.test.tsx`).

## 6. Testing in Vercel Preview

1. Set `FOUNDING_FAMILY_BETA_ENABLED=true` and `FOUNDING_FAMILY_BETA_DAYS=14`
   as Preview-scoped environment variables (Project Settings → Environment
   Variables → Preview).
2. Run the migration against the Preview database once:
   `DATABASE_URL=<preview-db-url> npm run db:migrate`.
3. Create an invite against the same Preview database
   (`DATABASE_URL=<preview-db-url> npm run beta:invite -- create ...`) and
   walk the same flow as local testing, using the Preview deployment's URL.

## 7. Activating in Production

1. Apply the migration to the production database (see Deployment order
   below) — this alone does **not** enable the feature; it only adds the
   schema.
2. Set `FOUNDING_FAMILY_BETA_ENABLED=true` and `FOUNDING_FAMILY_BETA_DAYS=14`
   as Production environment variables and redeploy (or trigger a redeploy
   so the running instances pick up the new env vars).
3. Create the 10 invites: `DATABASE_URL=<prod-db-url> npm run beta:invite --
   create <email>` per family, and send each link directly to that family.

## 8. Disabling the feature without affecting existing beta entitlements

Set `FOUNDING_FAMILY_BETA_ENABLED` to anything other than `true` (or unset
it) and redeploy. This only blocks the *activation* endpoint (no new beta
grants, and any still-`pending` invites simply can't be redeemed until
re-enabled) — it does **not** touch already-granted beta subscriptions.
`isBillingCurrent` keys off each row's own `status`/`current_period_end`,
not the feature flag, so families already in their 14 days keep their access
uninterrupted, and it will still expire normally on schedule.

## 9. Manual QA checklist

- [ ] Invited user (matching email, valid unexpired invite, feature enabled)
      sees "Join the Founding Family Beta", "No card required", and no
      Stripe Monthly/Annual selector at Step 5.
- [ ] Clicking "Continue with free beta" shows a loading state, disables the
      button, and advances to Step 6 on success.
- [ ] Double-clicking the button does not create a second entitlement
      (`SELECT count(*) FROM subscriptions WHERE parent_id = ...` stays 1).
- [ ] Refreshing or navigating back to Step 5 after a successful activation
      lands forward at Step 6, without re-activating or erroring.
- [ ] An expired, revoked, already-redeemed, or garbage token shows a single
      generic error ("This invitation link is invalid, expired, or already
      used.") — never a stack trace or a hint about which reason applied.
- [ ] A signed-in user whose email does NOT match the invite cannot activate
      it (same generic error).
- [ ] A non-invited user (no `?invite=` at all) sees the unchanged Stripe
      trial screen and can complete a normal checkout.
- [ ] With `FOUNDING_FAMILY_BETA_ENABLED` unset/false, the beta endpoint
      returns 503 even for a perfectly valid invite/token.
- [ ] The parent-profile Billing section shows "Founding Family Beta · ends
      <date>" while active, and the ended-beta message once
      `current_period_end` is in the past — with a working "Start 7-day free
      trial" button to convert.
- [ ] Talking with the companion (`/app/talk`) works normally for an active
      beta parent, and is blocked (402-equivalent UI) once the beta expires.
- [ ] No `STRIPE_*` request appears in Stripe's dashboard/logs for any beta
      activation.

## 10. Migration / deployment ordering

1. **Migration first, always.** `0013_founding_family_beta.sql` adds the
   `beta_invites` table, the `beta` value on `subscription_status`, and the
   `beta_invite_id` column/unique constraint on `subscriptions`. It is purely
   additive (new table, new enum value, new nullable column + constraint) —
   no existing data is modified, and every existing query keeps working
   unchanged.
2. Deploy the application code (this is backward-compatible with the
   pre-migration schema failing closed: with `FOUNDING_FAMILY_BETA_ENABLED`
   unset, the new code path is never reached).
3. Set the two env vars and redeploy once you're ready to actually accept
   activations.
4. Create and send the 10 invite links.

Rollback: disabling is just unsetting `FOUNDING_FAMILY_BETA_ENABLED` (step 8
above) — no schema rollback is needed or recommended, since the new
table/column/enum value are inert when unused and dropping them would risk
existing beta rows for families already mid-beta.
