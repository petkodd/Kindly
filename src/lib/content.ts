/**
 * Marketing copy lives here so Copywriter + Marketing can edit without touching JSX.
 * Banned phrases (enforced in review): "cures loneliness", "treats depression",
 * "prevents dementia", "like a real friend", guaranteed-outcome language.
 */

export const HERO = {
  h1: 'For the moments you can’t be there',
  sub:
    'Kindly gives your aging parent a warm, patient companion to talk to — any time of day. You set it up. They simply talk. And every week, you get a gentle summary of how they’re doing.',
  primaryCta: { label: 'Set up the gift', href: '/app/onboarding' },
  secondaryCta: { label: 'See how it works', href: '/how-it-works' },
  trustline: 'Private by design · Cancel anytime · Built for older adults',
  disclosure:
    'Kindly is an AI companion — not a person, and never a replacement for family, caregivers, or doctors.',
};

export const PROBLEM = {
  h2: 'You can’t call every day. That’s okay.',
  body:
    'Life is full. The miles add up. Between work, kids, and everything else, the daily call to Mom or Dad doesn’t always happen — and the guilt does. Kindly isn’t here to replace your call. It’s here to fill the quiet hours in between, so your parent always has someone kind to talk to.',
};

export const STEPS = {
  h2: 'How Kindly works',
  items: [
    {
      title: 'You set it up',
      body:
        'In a few minutes, you create your parent’s companion and share a few memories — their late spouse’s name, the grandkids, the music they love. No tech skills needed on their end.',
    },
    {
      title: 'They simply talk',
      body:
        'Your parent opens one large button and starts talking. No passwords, no menus. Kindly listens, remembers what matters, and is patient every single time.',
    },
    {
      title: 'You stay close',
      body:
        'Each week, you receive a respectful summary of how your parent has been — warm moments, things they mentioned, and a gentle heads-up if something seems off.',
    },
  ],
};

export const SENIORS = {
  h2: 'Made for your parent, not just for you',
  body:
    'Most apps aren’t built for a 78-year-old’s hands or eyes. Kindly is. Large text. Big buttons. Voice-first, so they can just speak. No logins to remember.',
  bullets: [
    'Voice-first — your parent talks, Kindly listens',
    'One big button to start, nothing to figure out',
    'Large, high-contrast text that’s easy to read',
    'Works on the tablet or computer they already have',
  ],
};

export const TRUST = {
  h2: 'Private and safe, by design',
  body:
    'Trust is the whole point. Kindly is built on consent, data minimization, and clear boundaries. Your parent’s conversations are theirs. Family summaries are respectful — never raw transcripts.',
  bullets: [
    'Consent-based — your parent always knows what’s shared, and with whom',
    'Kindly never pretends to be human',
    'Never a replacement for family, caregivers, doctors, or 911',
    'You control the data, and can delete it anytime',
  ],
  cta: { label: 'Read our trust & privacy promise', href: '/trust-and-privacy' },
};

export const PRICING_TEASER = {
  h2: 'Simple plans for staying close',
  body:
    'Start with our Founding Family offer — your first month for $29. Plans include voice conversation, memory, and your weekly family summary. Cancel anytime.',
  cta: { label: 'See pricing', href: '/pricing' },
};

export const FINAL_CTA = {
  h2: 'Give your parent someone kind to talk to',
  body: 'For the moments you can’t be there — Kindly is.',
  primary: { label: 'Set up the gift', href: '/app/onboarding' },
  secondary: { label: 'Join the waitlist', href: '/waitlist' },
};

export const FOOTER_LEGAL =
  'Kindly is an AI companion intended for friendly conversation and connection. It is not a medical device or service and does not diagnose, treat, cure, or prevent any condition. In an emergency, call 911. If you or someone you love is in crisis, call or text 988 (US Suicide & Crisis Lifeline).';
