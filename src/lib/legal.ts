/**
 * Privacy policy and Terms of Use (chat 9). BOTH ARE DRAFTS that need legal
 * review before launch; the pages say so at the top. Every statement here is
 * meant to match what the code does today — if you change retention, vendors
 * or the data model, update this file in the same change.
 *
 * TODO (Petko): replace LEGAL_CONTACT with a real, monitored address and a
 * postal address before launch, and have counsel review both documents.
 */

export const LEGAL_DRAFT_NOTICE = 'DRAFT — requires legal review';

export const LEGAL_LAST_UPDATED = '2026-10-30';

export const LEGAL_CONTACT = {
  email: 'privacy@dearly.example.com',
  note: 'Placeholder address until launch.',
};

export interface LegalSection {
  id: string;
  h2: string;
  paragraphs?: string[];
  bullets?: string[];
  /** Optional sub-sections rendered as H3s. */
  subsections?: { h3: string; paragraphs?: string[]; bullets?: string[] }[];
}

export interface LegalDocument {
  h1: string;
  intro: string;
  sections: LegalSection[];
}

export const VENDORS: { name: string; purpose: string; data: string }[] = [
  {
    name: 'Anthropic',
    purpose: 'The AI model that writes the companion’s replies, checks messages for safety concerns, suggests memories and writes conversation summaries.',
    data: 'Conversation text, the parent’s first name and profile settings, and approved memories.',
  },
  {
    name: 'Deepgram',
    purpose: 'Turns the parent’s speech into text.',
    data: 'The audio of one spoken turn at a time. We ask Deepgram not to use it to improve its models (Model Improvement Program opt-out on every request). Dearly does not store the audio.',
  },
  {
    name: 'ElevenLabs',
    purpose: 'Reads the companion’s replies aloud.',
    data: 'The text of the companion’s reply. Never the parent’s own voice.',
  },
  {
    name: 'Resend',
    purpose: 'Sends account emails, family invitations, weekly summaries and safety alerts by email.',
    data: 'Recipient email addresses and the content of those emails.',
  },
  {
    name: 'Twilio',
    purpose: 'Sends safety alerts by text message to the family member who set Dearly up, if they gave a phone number and agreed to texts.',
    data: 'That phone number and the alert text. (Not active yet.)',
  },
  {
    name: 'Stripe',
    purpose: 'Takes payments and manages subscriptions.',
    data: 'Billing details and card information, which go directly to Stripe. Dearly never sees or stores full card numbers.',
  },
  {
    name: 'Sentry',
    purpose: 'Tells us when the app has an error, so we can fix it.',
    data: 'Technical error details. We scrub email addresses, conversation text and other personal details before anything is sent.',
  },
  {
    name: 'Vercel',
    purpose: 'Hosts the website and app.',
    data: 'Everything the app processes passes through its servers; it also keeps short-lived request logs.',
  },
];

export const PRIVACY_POLICY: LegalDocument = {
  h1: 'Privacy Policy',
  intro:
    'Dearly is an AI companion that an adult child (or anyone) sets up for an older parent or for themselves. This policy explains what we collect, why, who helps us run the service, how long we keep it, and what you can do about it. We collect as little as we can, and conversations are never shared word for word with family.',
  sections: [
    {
      id: 'who',
      h2: 'Who this policy covers',
      paragraphs: [
        'It covers the person who creates the account and pays (we call them the account holder), the person who talks with Dearly (the parent), and family members who are invited to receive weekly summaries.',
        'Dearly is for adults. It is not meant for children under 18.',
      ],
    },
    {
      id: 'collect',
      h2: 'What we collect',
      subsections: [
        {
          h3: 'From the account holder',
          bullets: [
            'Name, email address and password (stored only as a one-way hash).',
            'Optionally, a mobile number for safety alerts, and whether you agreed to receive alerts by text.',
            'Subscription and billing status. Card details are handled by Stripe, not by us.',
            'The parent’s profile you set up: first name, pronouns, city, relationship to you, language and speech settings.',
            'Memories you add about the parent, such as favorite music, family names or hometown.',
            'The email addresses of family members you invite to receive summaries.',
          ],
        },
        {
          h3: 'From the parent',
          bullets: [
            'What they say to Dearly, as text. When they speak, the audio is turned into text by Deepgram and then discarded; Dearly does not keep recordings.',
            'Memories suggested from conversations. They only become part of what Dearly remembers once the family confirms them. Details about health, mood or risk are never stored as memories.',
            'Their answers to our consent notices, with the exact words they were shown.',
          ],
        },
        {
          h3: 'Automatically',
          bullets: [
            'Basic usage events, such as a page being viewed or a button being tapped. We honor Do Not Track and Global Privacy Control: when either is on, we record nothing.',
            'How much each conversation costs us (voice minutes, characters read aloud, AI tokens), so we can run the service sustainably.',
            'Technical error reports, with personal details removed.',
          ],
        },
      ],
    },
    {
      id: 'use',
      h2: 'How we use it',
      bullets: [
        'To hold kind, personal conversations with the parent, using confirmed memories.',
        'To write a short weekly summary about what was talked about in general — never the conversation word for word, never quotes, money or other people’s private matters. Summaries are only sent once the parent has said yes on the talk screen and each recipient has accepted an invitation.',
        'To keep people safe: every message is checked for signs of a crisis. If the parent may be in danger, the family member who set Dearly up is told by email (and text, if they agreed), and the parent is told this will happen. Our team may review flagged conversations.',
        'To run, secure, bill for and improve the service. We do not sell personal information and we do not use it for advertising.',
      ],
    },
    {
      id: 'share',
      h2: 'Who we share it with',
      paragraphs: [
        'We share personal information only with the service providers below, only for the purpose listed, and with family members as described above. We may also disclose information if the law requires it or to protect someone’s safety.',
      ],
      bullets: VENDORS.map((v) => `${v.name} — ${v.purpose} Data: ${v.data}`),
    },
    {
      id: 'retention',
      h2: 'How long we keep it',
      bullets: [
        'Conversation transcripts are deleted automatically 30 days after they are created.',
        'Short conversation summaries and confirmed memories stay until you remove them or delete the profile.',
        'When you delete a parent profile or your account, it is removed from the app straight away and permanently purged within 30 days.',
        'Records of consent, safety reviews and costs are kept as long as the law or our safety duties require, without conversation text.',
      ],
    },
    {
      id: 'rights',
      h2: 'Your choices and rights',
      bullets: [
        'Export: ask us for a copy of your data (contact details below) and we will send it to the account email. A self-serve download button is coming.',
        'Delete: delete your whole account from the Account page, or ask us to delete a single parent profile. Deleting also cancels the subscription.',
        'Correct: edit or remove memories and profile details at any time.',
        'Summaries: the parent can say “Not now” to weekly summaries, and the account holder can remove any family member from the summary list.',
        'Depending on where you live (for example California), you may have further rights, such as to know, correct or delete your information. Contact us to use them; we will not treat you differently for doing so.',
      ],
    },
    {
      id: 'security',
      h2: 'Security',
      paragraphs: [
        'Data is encrypted in transit, passwords are hashed, talk links can be revoked, and access is separated so one family can never see another family’s data. No system is perfectly secure; if a breach affects you, we will tell you as the law requires.',
      ],
    },
    {
      id: 'health',
      h2: 'Not a medical service',
      paragraphs: [
        'Dearly is a companion, not a medical device or a health service. It does not diagnose or treat any condition and is not a substitute for family, caregivers, doctors or emergency services. In an emergency, call 911.',
      ],
    },
    {
      id: 'changes',
      h2: 'Changes to this policy',
      paragraphs: [
        'If we make an important change, we will tell account holders by email before it takes effect. The date at the top shows when this policy last changed.',
      ],
    },
    {
      id: 'contact',
      h2: 'Contact us',
      paragraphs: [`Questions or requests about privacy: ${LEGAL_CONTACT.email}.`],
    },
  ],
};

export const TERMS_OF_USE: LegalDocument = {
  h1: 'Terms of Use',
  intro:
    'These terms are the agreement between you and Dearly when you create an account, set up a companion for someone, or talk with Dearly. Please read them with our Privacy Policy.',
  sections: [
    {
      id: 'service',
      h2: 'What Dearly is',
      paragraphs: [
        'Dearly is an AI companion. It is software, not a person, and it says so. It offers friendly conversation and a short weekly summary for family. It is not a medical, mental-health, legal or financial service, and it does not replace family, caregivers, doctors, therapists or emergency services.',
      ],
    },
    {
      id: 'emergencies',
      h2: 'Emergencies',
      paragraphs: [
        'Dearly cannot call anyone. If someone may be in danger, call 911. Dearly shares crisis resources such as the 988 Suicide & Crisis Lifeline and alerts the account holder when a conversation suggests a possible crisis, but alerts can be delayed or fail, and Dearly can misunderstand what was said.',
      ],
    },
    {
      id: 'accounts',
      h2: 'Accounts and setting Dearly up for someone else',
      bullets: [
        'You must be 18 or older and give accurate information.',
        'If you set Dearly up for another adult, you confirm that you have told them about it and that they are free to use it or not. The parent is asked on their first conversation whether weekly summaries may be shared, and may say no.',
        'Keep your password and talk links private. You are responsible for activity on your account.',
      ],
    },
    {
      id: 'acceptable',
      h2: 'Acceptable use',
      bullets: [
        'Do not use Dearly to monitor someone without their knowledge, to harass anyone, or for anything unlawful.',
        'Do not try to break, overload, reverse-engineer or get around the safety rules of the service.',
        'Do not put other people’s sensitive personal information into memories without a good reason.',
      ],
    },
    {
      id: 'billing',
      h2: 'Subscriptions and billing',
      bullets: [
        'Paid plans renew automatically until cancelled. Prices and any free trial are shown before you pay.',
        'You can cancel at any time by contacting us, or by deleting your account, which cancels the subscription.',
        'Payments are processed by Stripe under its own terms.',
      ],
    },
    {
      id: 'content',
      h2: 'Your content',
      paragraphs: [
        'You own what you and the parent put into Dearly. You allow us to use it only to provide and secure the service, as described in the Privacy Policy. AI replies can be wrong or incomplete; please do not rely on them for important decisions.',
      ],
    },
    {
      id: 'ending',
      h2: 'Ending the service',
      paragraphs: [
        'You can stop using Dearly and delete your account at any time. We may suspend accounts that break these terms or put someone at risk, and we will tell you why unless the law or someone’s safety prevents it.',
      ],
    },
    {
      id: 'liability',
      h2: 'Disclaimers and limits of liability',
      paragraphs: [
        'Dearly is provided “as is”. To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability is limited to what you paid us in the 12 months before the claim. Nothing in these terms limits rights you have under consumer law that cannot be waived.',
      ],
    },
    {
      id: 'changes',
      h2: 'Changes to these terms',
      paragraphs: [
        'If we make an important change, we will tell account holders by email before it takes effect. Continuing to use Dearly after that means you accept the new terms.',
      ],
    },
    {
      id: 'contact',
      h2: 'Contact us',
      paragraphs: [`Questions about these terms: ${LEGAL_CONTACT.email}.`],
    },
  ],
};
