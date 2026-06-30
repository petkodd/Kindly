export default function TalkPage() {
  return (
    <div className="mx-auto max-w-md text-center">
      <p className="rounded-xl border border-line bg-cloud px-4 py-3 text-base text-muted">
        Kindly is an AI companion — not a real person.
      </p>
      <h1 className="mt-8 font-display text-3xl font-semibold text-ink">Hi 👋</h1>
      <button
        type="button"
        className="mt-10 flex h-40 w-40 mx-auto items-center justify-center rounded-full bg-sage text-cloud shadow-md"
        aria-label="Talk to Kindly"
      >
        <svg viewBox="0 0 24 24" className="h-16 w-16">
          <path fill="currentColor" d="M12 14a3 3 0 003-3V6a3 3 0 00-6 0v5a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z" />
        </svg>
      </button>
      <p className="mt-6 text-xl font-semibold text-ink">Talk to Kindly</p>
      <p className="mt-2 text-base text-muted">Voice conversation ships on feature/voice-conversation.</p>
    </div>
  );
}
