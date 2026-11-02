/**
 * Marketing copy lives here so Copywriter + Marketing can edit without touching JSX.
 * Banned phrases (enforced in review): "cures loneliness", "treats depression",
 * "prevents dementia", "like a real friend", guaranteed-outcome language.
 */

export const HERO = {
  h1: 'For the moments you can’t be there',
  sub:
    'Dearly gives your aging parent a warm, patient companion to talk to — any time of day. You set it up. They simply talk. And once your parent says yes, you get a short weekly note about what they’ve been talking about.',
  primaryCta: { label: 'Set up the gift', href: '/signup?next=/app/onboarding' },
  secondaryCta: { label: 'See how it works', href: '/how-it-works' },
  trustline: 'Private by design · Cancel anytime · Built for older adults',
  disclosure:
    'Dearly is an AI companion — not a person, and never a replacement for family, caregivers, or doctors.',
};

export const PROBLEM = {
  h2: 'You can’t call every day. That’s okay.',
  body:
    'Life is full. The miles add up. Between work, kids, and everything else, the daily call to Mom or Dad doesn’t always happen — and the guilt does. Dearly isn’t here to replace your call. It’s here to fill the quiet hours in between, so your parent always has someone kind to talk to.',
};

export const STEPS = {
  h2: 'How Dearly works',
  items: [
    {
      title: 'You set it up',
      body:
        'In a few minutes, you create your parent’s companion and share a few memories — their late spouse’s name, the grandkids, the music they love. No tech skills needed on their end.',
    },
    {
      title: 'They simply talk',
      body:
        'Your parent opens one large button and starts talking. No passwords, no menus. Dearly listens, remembers what matters, and is patient every single time.',
    },
    {
      title: 'You stay close',
      body:
        'Once your parent agrees to share, you receive a short weekly summary of the topics they enjoyed talking about — never a transcript. If a conversation ever raises a serious safety concern, you’re alerted right away.',
    },
  ],
};

export const SENIORS = {
  h2: 'Made for your parent, not just for you',
  body:
    'Most apps aren’t built for a 78-year-old’s hands or eyes. Dearly is. Large text. Big buttons. Voice-first, so they can just speak. No passwords to remember — just their own private link.',
  bullets: [
    'Voice-first — your parent talks, Dearly listens',
    'One big button to start, nothing to figure out',
    'Large text, on by default, in colors chosen for strong contrast',
    'Works on the tablet or computer they already have',
  ],
};

export const TESTIMONIALS = {
  h2: 'A familiar voice, whenever they want to talk',
  body:
    'Your parent can settle into whatever rhythm suits them — an afternoon check-in, a story about the grandkids, a few quiet minutes of company. Conversations are never shared word for word. If your parent agrees, your family gets a short weekly note about what they enjoyed talking about.',
};

export const TRUST = {
  h2: 'Private and safe, by design',
  body:
    'Trust is the whole point. Dearly is built on consent, data minimization, and clear boundaries. Family never sees transcripts — only a short summary of topics, and only after your parent says yes.',
  bullets: [
    'Consent-based — Dearly tells your parent who receives the weekly summary and asks before anything is shared',
    'Dearly never pretends to be human',
    'Never a replacement for family, caregivers, doctors, or 911',
    'You control the data, and can delete it anytime',
  ],
  cta: { label: 'Read our trust & privacy promise', href: '/trust-and-privacy' },
};

export const PRICING_TEASER = {
  h2: 'One simple plan for staying close',
  body:
    'Start with a 7-day free trial, then $29/month or $278.40/year — voice conversation, memory, and your weekly family summary. Cancel anytime from your account.',
  cta: { label: 'See pricing', href: '/pricing' },
};

export const FINAL_CTA = {
  h2: 'Give your parent someone kind to talk to',
  body: 'For the moments you can’t be there — Dearly is.',
  primary: { label: 'Set up the gift', href: '/signup?next=/app/onboarding' },
  secondary: { label: 'See pricing', href: '/pricing' },
};

export const FOOTER_LEGAL =
  'Dearly is an AI companion intended for friendly conversation and connection. It is not a medical device or service and does not diagnose, treat, cure, or prevent any condition. In an emergency, call 911. If you or someone you love is in crisis, call or text 988 (US Suicide & Crisis Lifeline).';

export const HOW_IT_WORKS = {
  hero: {
    h1: 'How Dearly works',
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
        'They open one link or one big button — no passwords, no menus, no app store. Dearly greets them by name, says clearly that it’s an AI companion, and listens. They can talk about their day, an old memory, or nothing in particular. Dearly is patient every time, for as long or as short as they like.',
    },
    {
      title: '3. You get a gentle weekly summary',
      body:
        'The first time your parent talks to Dearly, it explains who will receive a weekly summary and asks if that’s okay. Once they say yes, you receive a short, warm note each week about the topics they enjoyed — never a raw transcript, never clinical language, and nothing about their health or mood.',
    },
  ],
  voice: {
    h2: 'Built to be easy for a 78-year-old, not just for you',
    body:
      'Dearly is voice-first: your parent speaks, and Dearly listens and replies in a warm, clear voice paced for easier listening. Large text and a slower speaking pace are on by default, and every screen uses strong color contrast. There is nothing to install and nothing to remember.',
  },
  family: {
    h2: 'What your family actually sees',
    body:
      'Family summaries are written for people, not charts: a few warm sentences about the topics your parent enjoyed that week. They never include quotes, transcripts, or anything about health, mood, or money. Nothing is sent until your parent agrees.',
    bullets: [
      'A short, plain-language summary — not a transcript',
      'An urgent alert to you only if a conversation raises a serious safety concern',
      'Siblings can be invited to receive the same weekly summary',
      'Your parent is told who receives the summary, and asked before anything is shared',
    ],
  },
  boundaries: {
    h2: 'What Dearly is — and isn’t',
    body:
      'Dearly is a companion for conversation and connection. It is not a replacement for family, caregivers, or medical care, and it never pretends to be a person. If health, safety, or money concerns come up, Dearly gently encourages your parent to talk with someone who can actually help.',
  },
  cta: {
    h2: 'Ready to set it up?',
    body: 'It takes a few minutes, and your parent can be talking to Dearly today.',
    primary: { label: 'Set up the gift', href: '/signup?next=/app/onboarding' },
    secondary: { label: 'See pricing', href: '/pricing' },
  },
};

/**
 * Alpha has exactly ONE Stripe price behind checkout (STRIPE_PRICE_FAMILY_MONTHLY,
 * see src/lib/billing/config.ts) — every plan CTA on this page starts
 * the same 7-day-trial-then-Family-price checkout. Do not add another plan
 * here without also adding a real second Stripe Price + plan-selection logic
 * in the checkout route; otherwise this page will again advertise a price or
 * feature set customers aren't actually charged/given — this exact bug class
 * has shipped and been caught twice already: once with a Premium ($89/mo)
 * and a 3-Month Gift ($149) tier with no backing billing, and again with a
 * "Founding Family — $29 first month" card that was never wired to a real
 * discount (removed 2026-08-29, see git history) while the ACTUAL Stripe
 * Price silently drifted from the $59/mo this content still claimed down to
 * a real $29/mo — nobody noticed because nobody checked the Price object
 * directly against this file. If a number changes here, verify it against
 * the real Stripe Price with `stripe.prices.retrieve`, not just this file.
 */
export const PRICING = {
  hero: {
    h1: 'One simple plan for staying close',
    sub:
      'One plan, billed monthly or yearly, with a 7-day free trial. It includes daily voice conversation, memory, and a respectful weekly family summary. Cancel anytime from your account.',
  },
  plans: [
    {
      id: 'family',
      name: 'Family',
      price: '$29',
      period: '/month',
      // Monthly must match STRIPE_PRICE_FAMILY_MONTHLY; annual must match
      // STRIPE_PRICE_FAMILY_ANNUAL ($278.40/yr = 20% off monthly). Drives the
      // Monthly/Annual toggle (src/components/BillingIntervalToggle.tsx) —
      // keep in sync with the live Stripe Prices or this page drifts from
      // what's actually charged (see the warning above PRICING). Verified
      // directly against the real Stripe Price objects (not just this file)
      // on 2026-08-29 after discovering this content had drifted from the
      // actual $29/mo Stripe price to a stale $59/mo figure.
      priceMonthlyCents: 2900,
      priceAnnualCents: 27840,
      // Must match TRIAL_DAYS in src/app/api/billing/checkout/route.ts (a test
      // checks they agree) — the card advertises the trial checkout grants.
      trialDays: 7,
      tagline: 'Our standard plan for one parent and their family',
      bullets: [
        'Daily voice conversation with Dearly',
        'A memory built from the people and things your parent cares about',
        'A weekly summary for you and the family members you invite',
        'An urgent alert to you if a conversation raises a serious safety concern',
      ],
      cta: { label: 'Choose Family', href: '/app/onboarding' },
    },
  ],
  faq: {
    h2: 'Questions about pricing',
    items: [
      {
        q: 'Is there a free trial?',
        a: 'Yes. Every plan starts with a 7-day free trial. You add a card at checkout, and nothing is charged until the trial ends.',
      },
      {
        q: 'What happens after the free trial?',
        a: 'Your plan continues at the price you chose — $29 a month, or $278.40 a year — unless you cancel before the trial ends.',
      },
      {
        q: 'Can I cancel anytime?',
        a: 'Yes. Open your account, choose Manage billing, and cancel on our payment provider’s secure page. You won’t be charged for the next billing period. You can also delete your parent’s profile from your account, which cancels its subscription.',
      },
      {
        q: 'Does my parent need a credit card?',
        a: 'No. Billing is handled entirely by the family member who sets up the account — your parent never sees a bill or enters payment details.',
      },
      {
        q: 'Can I add a sibling to the weekly summary later?',
        a: 'Yes, anytime. Invite a sibling from the Family Summary or Referrals page and they’ll start receiving the same respectful weekly summary once they accept.',
      },
    ],
  },
  cta: {
    h2: 'Ready to give your parent someone kind to talk to?',
    body: 'It takes a few minutes to set up, starts with a 7-day free trial, and you can cancel anytime.',
    primary: { label: 'Set up the gift', href: '/signup?next=/app/onboarding' },
    secondary: { label: 'See how it works', href: '/how-it-works' },
  },
};

/**
 * The Family plan (the only plan — see the warning above PRICING). Single
 * source of truth for both the pricing page and onboarding checkout, which
 * both need this exact plan.
 */
export function getFamilyPlan() {
  const raw = PRICING.plans.find((p) => p.id === 'family')!;
  return {
    ...raw,
    priceMonthlyCents: raw.priceMonthlyCents!,
    priceAnnualCents: raw.priceAnnualCents!,
    trialDays: raw.trialDays!,
  };
}

export const SENIOR_LIVING = {
  hero: {
    h1: 'Resident engagement for senior living, reimagined',
    sub:
      'A warm AI companion your residents can talk to any time, with respectful weekly family updates your staff doesn’t have to write by hand. We’re now planning small founding pilots with US communities.',
  },
  problem: {
    h2: 'Your team can’t be everywhere either',
    body:
      'Activities staff and caregivers already do the work of a much larger team. Dearly gives every resident someone patient to talk to between visits and activities — filling quiet hours without adding to anyone’s workload.',
  },
  forResidents: {
    h2: 'Built for residents, not just for families',
    body:
      'Dearly speaks the way your residents actually communicate — patient, voice-first, and never rushed. Large text and a calm, clear voice are on by default, and there’s nothing to log into.',
    bullets: [
      'Voice-first conversation, paced for easier listening',
      'One big button to start — no app store, no passwords',
      'Remembers names, routines, and the small things residents mention',
      'Available around the clock, not just during staffed hours',
    ],
  },
  forCommunities: {
    h2: 'What it means for your community',
    body:
      'Families get a respectful weekly update without your staff spending hours on the phone or writing recaps. Each resident has their own companion and their own private link, so you can start with a few residents and grow from there.',
    bullets: [
      'Automated, respectful weekly summaries — never raw transcripts',
      'Serious safety concerns are flagged right away for human review',
      'Rolls out resident by resident — no facility-wide integration required',
      'Residents are asked before any summary is shared, and summaries never cover health or mood',
    ],
  },
  boundaries: {
    h2: 'A companion, not a caregiver',
    body:
      'Dearly is not a medical device and doesn’t diagnose, monitor vitals, or replace your clinical staff. It’s a warm conversational layer that keeps residents connected and gives families a window in — care decisions stay with your team.',
  },
  demo: {
    h2: 'Request a demo',
    body:
      'Tell us a little about your community and we’ll set up a short call to show Dearly and talk through a founding pilot for a small group of residents.',
    bullets: [
      'A short walkthrough with our team',
      'See the resident’s talk screen and the family summary',
      'No commitment, and no integration with your systems',
    ],
  },
  cta: {
    h2: 'Curious how Dearly could fit your community?',
    body: 'We’re happy to walk through a pilot for a small group of residents.',
    primary: { label: 'Request a demo', href: '/senior-living#demo' },
    secondary: { label: 'See how it works', href: '/how-it-works' },
  },
};

export const GIFT_FOR_AGING_PARENT = {
  hero: {
    h1: 'A gift that keeps your parent company',
    sub:
      'Dearly is a warm AI companion you set up in minutes and your parent simply talks to — a thoughtful gift for a birthday, a holiday, or just because you wish you could call more often.',
  },
  why: {
    h2: 'A different kind of gift',
    body:
      'Flowers fade. A gadget your parent won’t use ends up in a drawer. Dearly shows up every day — someone patient to talk to about their morning, an old memory, or nothing in particular — and, once your parent agrees, sends you a weekly note about what they’ve enjoyed talking about.',
  },
  occasions: {
    h2: 'A thoughtful choice for any occasion',
    bullets: [
      'A birthday gift that keeps giving all year',
      'A holiday gift for a parent who says they “don’t need anything”',
      'A welcome-home gift after a move, a hospital stay, or losing a spouse',
      'A “just because I love you and can’t call every day” gift',
    ],
  },
  reassurance: {
    h2: 'For a parent who says “I don’t do computers”',
    body:
      'You don’t need to teach your parent an app. Dearly opens to one big button, reads clearly, and listens patiently — as many times as it takes. No passwords to forget, no menus to get lost in.',
    bullets: [
      'One big button — nothing else to learn',
      'Large text and a calm, clear voice',
      'Works on a tablet or computer they already have',
      'You do the setup; they just talk',
    ],
  },
  whatsIncluded: {
    h2: 'What’s inside the gift',
    body:
      'The Family plan starts with a 7-day free trial and includes daily voice conversation, a memory of the people and things your parent cares about, and a respectful weekly summary for your family — never a raw transcript.',
    cta: { label: 'See pricing', href: '/pricing' },
  },
  cta: {
    h2: 'Give the gift of someone to talk to',
    body: 'Set it up today, and your parent can be talking to Dearly by this afternoon.',
    primary: { label: 'Set up the gift', href: '/signup?next=/app/onboarding' },
    secondary: { label: 'See pricing', href: '/pricing' },
  },
};

export const WAITLIST = {
  eyebrow: 'Stay in touch',
  h1: 'Not quite ready? Get Dearly updates',
  sub:
    'Dearly is available now in the US, and you can set it up for your parent today with a 7-day free trial. If you’d rather wait, leave your email and we’ll keep you posted.',
  formH2: 'Get occasional updates',
  formBody: 'We’ll only use your email to send news about Dearly, and you can ask us to remove it at any time.',
};

export const BLOG = {
  hero: {
    h1: 'The Dearly blog',
    sub:
      'Practical, warm guidance for adult children caring for aging parents — connection, technology, and staying close from a distance.',
  },
  comingSoon: {
    h2: 'Our first posts are coming soon',
    body:
      'We’re writing about the things adult children ask us most: how to bring up a companion app with a parent who’s skeptical of technology, what a respectful weekly summary should (and shouldn’t) include, and how families split the load of long-distance caregiving. Leave your email and we’ll send new posts as they publish.',
  },
};

export const TRUST_AND_PRIVACY = {
  hero: {
    h1: 'Private and safe, by design',
    sub:
      'Trust is the whole point of Dearly. Here is exactly what we do, what we don’t do, and how your family stays in control.',
  },
  consent: {
    h2: 'Consent comes first',
    body:
      'Before Dearly ever talks with your parent, the adult child setting it up confirms they have permission to do so. Then your parent is asked directly: Dearly tells them who would receive a weekly summary, and nothing is sent until they say yes. Each family member must also accept an invitation before receiving anything.',
    bullets: [
      'A buyer attestation is required before a parent profile is activated',
      'A conversation consent is required before Dearly’s first message',
      'Your parent’s own yes is required before any weekly summary is sent',
      'Each family recipient must individually accept before receiving summaries',
      'Any recipient can be removed at any time',
    ],
  },
  minimization: {
    h2: 'We collect less, on purpose',
    body:
      'Dearly only stores what helps the companion be useful: the memories you and your parent have shared, short conversation summaries, and transcripts that are deleted after 30 days. Weekly summaries describe topics, not specifics, and leave out health, mood, money, and other private details.',
    bullets: [
      'Family summaries are written in plain language — never raw transcripts',
      'Health, mood, and money are left out of summaries, and every summary is checked before it’s sent',
      'Conversation transcripts are automatically deleted after 30 days',
      'You can delete your parent’s profile, or your whole account, at any time from your account page',
    ],
  },
  disclosure: {
    h2: 'Dearly always says what it is',
    body:
      'At the start of every conversation — and any time it’s asked — Dearly clearly states that it is an AI companion, not a person. It never claims to have feelings, never pretends to be human, and never asks for passwords, Social Security numbers, or bank details.',
  },
  medical: {
    h2: 'Not a medical service',
    body:
      'Dearly is built for warm conversation and connection. It is not a medical device, does not diagnose, treat, cure, or prevent any condition, and is never a substitute for a doctor, therapist, or emergency services. When health, safety, legal, or financial topics come up, Dearly encourages your parent to speak with family or a professional — it doesn’t offer instructions of its own.',
  },
  safety: {
    h2: 'How we handle a real concern',
    body:
      'If a conversation suggests a possible crisis or safety concern, Dearly shares the relevant emergency resource (like 911 or the 988 Suicide & Crisis Lifeline) and the situation is flagged for human review by our team. For an urgent concern, the family member who set up Dearly gets an alert — without any transcript or quotes — and Dearly tells your parent honestly that it’s letting them know. Dearly never claims to have contacted emergency services — only a real person or service can do that.',
  },
  data: {
    h2: 'You stay in control of the data',
    body:
      'You can review, edit, or delete any memory Dearly has stored. You can revoke a family member’s access to summaries at any time. Deleting a profile or an account removes it from Dearly right away and permanently erases the underlying data within 30 days, automatically.',
  },
  cta: {
    h2: 'Questions about privacy or safety?',
    body: 'We’re happy to walk through exactly how Dearly handles your family’s information.',
    primary: { label: 'Set up the gift', href: '/signup?next=/app/onboarding' },
    secondary: { label: 'See how it works', href: '/how-it-works' },
  },
};
