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

export const HOW_IT_WORKS = {
  hero: {
    h1: 'How Kindly works',
    sub:
      'Three simple steps: you set it up, your parent talks, and your family stays close. No apps to learn on their end — just one big button.',
  },
  steps: [
    {
      title: '1. You set up the gift',
      body:
        'Create a profile for your parent in a few minutes — their name, how they like to be addressed, and a few memories that help conversation feel personal: a late spouse’s name, the grandkids, the music they love. You confirm you have their permission before anything is active.',
    },
    {
      title: '2. Your parent simply talks',
      body:
        'They open one link or one big button — no passwords, no menus, no app store. Kindly greets them by name, says clearly that it’s an AI companion, and listens. They can talk about their day, an old memory, or nothing in particular. Kindly is patient every time, for as long or as short as they like.',
    },
    {
      title: '3. You get a gentle weekly summary',
      body:
        'Once a week, you receive a short, warm summary of how your parent has been — never a raw transcript, never clinical language. If something seems off, you get a gentle heads-up so you can check in, not a diagnosis.',
    },
  ],
  voice: {
    h2: 'Built to be easy for a 78-year-old, not just for you',
    body:
      'Kindly is voice-first: your parent speaks, and Kindly listens and replies in a warm, clear voice paced for easier listening. Large text and high contrast are on by default. There is nothing to install and nothing to remember.',
  },
  family: {
    h2: 'What your family actually sees',
    body:
      'Family summaries are written for people, not charts: a few warm sentences about the week, occasional highlights your parent mentioned, and a coarse note if the tone of a conversation seemed low. Raw conversations stay private to your parent unless they choose otherwise.',
    bullets: [
      'A short, plain-language summary — not a transcript',
      'A gentle heads-up only when something seems worth a check-in',
      'Siblings can be invited to receive the same weekly summary',
      'Your parent knows what’s shared, and with whom',
    ],
  },
  boundaries: {
    h2: 'What Kindly is — and isn’t',
    body:
      'Kindly is a companion for conversation and connection. It is not a replacement for family, caregivers, or medical care, and it never pretends to be a person. If health, safety, or money concerns come up, Kindly gently encourages your parent to talk with someone who can actually help.',
  },
  cta: {
    h2: 'Ready to set it up?',
    body: 'It takes a few minutes, and your parent can be talking to Kindly today.',
    primary: { label: 'Set up the gift', href: '/app/onboarding' },
    secondary: { label: 'See pricing', href: '/pricing' },
  },
};

export const TRUST_AND_PRIVACY = {
  hero: {
    h1: 'Private and safe, by design',
    sub:
      'Trust is the whole point of Kindly. Here is exactly what we do, what we don’t do, and how your family stays in control.',
  },
  consent: {
    h2: 'Consent comes first',
    body:
      'Before Kindly ever talks with your parent, the adult child setting it up confirms they have permission to do so. Before any weekly summary is delivered to a family member, that family member must accept an invitation — no one receives updates about your parent without an explicit yes.',
    bullets: [
      'A buyer attestation is required before a parent profile is activated',
      'A conversation consent is required before Kindly’s first message',
      'Each family recipient must individually accept before receiving summaries',
      'Any recipient can be removed at any time',
    ],
  },
  minimization: {
    h2: 'We collect less, on purpose',
    body:
      'Kindly only stores what helps the companion be useful — confirmed memories your parent has shared, and short conversation summaries. Sensitive details about health, mood, or risk are marked private and are never included in anything shared with family.',
    bullets: [
      'Family summaries are written in plain language — never raw transcripts',
      'Sensitive topics (health, mood, risk) are excluded from anything shareable',
      'Conversation recordings/transcripts are automatically deleted on a retention schedule',
      'You can delete your account and your parent’s data at any time',
    ],
  },
  disclosure: {
    h2: 'Kindly always says what it is',
    body:
      'At the start of every conversation — and any time it’s asked — Kindly clearly states that it is an AI companion, not a person. It never claims to have feelings, never pretends to be human, and never asks for passwords, Social Security numbers, or bank details.',
  },
  medical: {
    h2: 'Not a medical service',
    body:
      'Kindly is built for warm conversation and connection. It is not a medical device, does not diagnose, treat, cure, or prevent any condition, and is never a substitute for a doctor, therapist, or emergency services. When health, safety, legal, or financial topics come up, Kindly encourages your parent to speak with family or a professional — it doesn’t offer instructions of its own.',
  },
  safety: {
    h2: 'How we handle a real concern',
    body:
      'If a conversation suggests a possible crisis or safety concern, Kindly shares the relevant emergency resource (like 911 or the 988 Suicide & Crisis Lifeline) and the situation is flagged for human review by our team. Kindly never claims to have contacted emergency services on your behalf — only a real person or service can do that.',
  },
  data: {
    h2: 'You stay in control of the data',
    body:
      'You can review, edit, or delete any memory Kindly has stored. You can revoke a family member’s access to summaries at any time. Deleting an account removes the underlying data on a fixed retention schedule, honored automatically.',
  },
  cta: {
    h2: 'Questions about privacy or safety?',
    body: 'We’re happy to walk through exactly how Kindly handles your family’s information.',
    primary: { label: 'Set up the gift', href: '/app/onboarding' },
    secondary: { label: 'Join the waitlist', href: '/waitlist' },
  },
};
