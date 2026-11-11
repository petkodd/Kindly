# Chat 11 evidence: ?ref walkthrough (local, headless Chromium)

Production build (`npm run build && next start -p 3100`) against the local
Postgres from `scripts/autopilot/setup-local-db.sh` (migrations 0001–0020 +
seed). Script: `walkthrough.cjs` (run with Playwright on NODE_PATH).
Screenshots at 375 / 768 / 1280.

Log of the run:

```
[walk] referrer code XHJ8PVYVG3
[walk] cookie after ?ref XHJ8PVYVG3 expires in days 30
[walk] signup prefilled code for family-…@example.com = "XHJ8PVYVG3"
[walk] code redeemed by family-…@example.com
[walk] family parent 74f9d44e-…
[walk] signup prefilled code for third-…@example.com = ""
[walk] checkout field prefilled 9NMWXKYJR3
[walk] code2 redeemed by third-…@example.com
[walk] self redeem [ 400, 'You cannot redeem your own referral code.' ]
[walk] OK
```

| Screens | What |
|---|---|
| 01-referrer-code-* | demo buyer gets their code + link on /app/referrals |
| 02-signup-prefilled-* | new family opened `/?ref=code`, then /signup: field prefilled from the 30-day cookie |
| 03-onboarding-applied-* | that family's checkout step: "Referral code applied" (redeemed at account creation) |
| 04-referrer-pending-* | referrer sees the redemption as "Pending: waiting for their first payment" |
| 05-onboarding-field-* | a family without a code opens checkout with `?ref=`: field prefilled, "Apply code" redeems it |

The credit itself (invoice.paid → two Stripe balance credits) needs a signed
Stripe webhook, so it is covered by tests with Stripe mocked
(`test/routes/referralCredit.route.test.ts`), not by this walkthrough.
