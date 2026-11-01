# Accessibility and design system (chat 12)

Target: WCAG 2.2 AA plus senior-friendly sizing on every app screen.

## Rules

- **Colours** come from `src/design/tokens.mjs` (Tailwind reads it). `npm run contrast`
  prints the WCAG table and fails if any pair drops below AA (a unit test does the same).
  - `error` (#A4472B) for errors, destructive actions, the "Sensitive" badge.
  - `clay` is decorative only. `text-clay`/`bg-clay` are banned by a source-guard test.
  - `line` is for decorative hairlines; form controls use `field` (≥3:1).
- **Type:** app and parent screens use `text-base` (19px) or larger. `text-xs`/`text-sm`
  are floored at 16/17px and banned under `src/app/(app)` and `src/app/(talk)` (test).
- **Tap targets:** ≥44px everywhere (`min-h-[2.75rem]`), ≥56px on parent screens
  (`btn-primary` is 3.5rem; the talk buttons are larger).
- **Forms:** every set of inputs is a `<form>` (Enter submits). Inputs use `formStyles.ts`
  (`inputCls`, `inputOnPageCls`, `labelCls`, `helpCls`, `fieldErrorCls`, `checkCls`).
  Invalid fields get `aria-invalid="true"` and `aria-describedby` pointing at the message.
- **Messages:** `<FormStatus kind="error|success|info">`. Errors are `role="alert"`;
  success/info sit in an always-present polite live region. Colour is never the only cue.
- **Shared pieces:** `<Card>`, `<StatusBadge>`, `<CtaBand>`, `<FormStatus>`; one `Parent`
  type in `src/lib/types.ts`.
- **Focus:** the global `:focus-visible` outline (3px sageDeep). Never `outline-none` (test).
- **Skip link** in the root layout targets `<main id="main" tabIndex={-1}>`; every page's
  `<main>` carries that id (test). Branded `not-found.tsx` and `error.tsx`.
- **Unsaved changes:** `useUnsavedChangesWarning(dirty)` (beforeunload + in-app link guard).

## Running the axe check (local only)

The axe run needs a production build and the seeded **local** database, so it is a
separate script and CI does not run it.

```bash
DB=$(bash scripts/autopilot/setup-local-db.sh)   # local throwaway Postgres
# .env.local: DATABASE_URL=$DB, PGSSL=disable, DEMO_MODE=true, DEMO_PASSWORD=demo-pass-123, SESSION_SECRET=…
npm run db:seed
npm run build && npm start &
npm run test:a11y            # BASE_URL=http://localhost:3000 by default (refuses non-local URLs)
```

It scans home, pricing, signup, login, 404, onboarding, parent profile, memories (and its
add form with errors), family summary, referrals, account and the parent's talk screen
(intro and conversation) at 375 and 1280px with the WCAG 2.0/2.1/2.2 A+AA rules, prints
every violation, writes `a11y-report.json`, and exits 1 on any serious or critical one.
It re-runs `db/seed.mjs` to get a fresh talk link unless `TALK_URL` is set.
