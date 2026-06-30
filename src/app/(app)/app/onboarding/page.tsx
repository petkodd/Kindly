export default function OnboardingPage() {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow">Gift onboarding</p>
      <h1 className="mt-3 font-display text-3xl font-semibold text-ink">Set up the gift</h1>
      <p className="mt-4 text-lg text-muted">
        Multi-step flow (who it’s for → consent gate → memory seed → access handoff) ships on
        <code className="mx-1 rounded bg-cloud px-1">feature/gift-onboarding</code>. Wireframes and
        acceptance criteria are in the Cycle&nbsp;2 backlog (US-4, US-5).
      </p>
      <div className="mt-8 rounded-2xl border border-line bg-cloud p-6">
        <p className="text-base text-ink">Next: consent gate must pass before a parent profile activates.</p>
      </div>
    </div>
  );
}
