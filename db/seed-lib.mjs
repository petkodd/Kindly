// Demo seed: the localhost guard and the data itself. The CLI wrapper is
// db/seed.mjs (`npm run db:seed`). Kept free of app imports (like
// db/migrate.mjs) so it runs with plain `node` and is testable on pg-mem.
//
// Idempotent: every seeded row has a fixed id. Each run deletes the demo
// parent (its conversations, memories, flags, summaries, consents and
// tokens cascade) and the demo subscription/invite, then recreates them
// with timestamps in the CURRENT week, so re-running also refreshes the
// demo. The two demo users are upserted by email and never deleted.
import { createHash, randomBytes, scryptSync } from 'node:crypto';

export const LOCAL_DB_HOSTS = ['localhost', '127.0.0.1'];
export const DEMO_EMAIL = 'demo@kindly.test';
export const ADMIN_EMAIL = 'admin@kindly.test';
export const RECIPIENT_EMAIL = 'sibling@kindly.test';
export const PARENT_FIRST_NAME = 'Mom (demo)';
const MIN_PASSWORD = 8; // matches src/lib/repos/user.ts

/** Fixed ids so a re-run replaces rows instead of duplicating them. */
const ID = (n) => `5eed0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const SEED_IDS = {
  demoUser: ID(1),
  adminUser: ID(2),
  parent: ID(10),
  betaInvite: ID(20),
  subscription: ID(21),
  consentAttestation: ID(30),
  consentParent: ID(31),
  consentRecipient: ID(32),
  summary: ID(40),
  delivery: ID(41),
  flag: ID(50),
};

/**
 * Refuse to seed anything but a local, non-production database. Returns the
 * host on success; throws an Error whose message is safe to print (it names
 * the host, never the full URL or password).
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function assertSafeSeedTarget(env = process.env) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is "production". The demo seed is for local development only.');
  }
  if (env.VERCEL_ENV === 'production') {
    throw new Error('Refusing to seed: VERCEL_ENV is "production".');
  }
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error('Refusing to seed: DATABASE_URL is not set. Copy .env.example to .env.local first.');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Refusing to seed: DATABASE_URL is not a valid postgres:// URL.');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`Refusing to seed: DATABASE_URL must start with postgres:// (got "${parsed.protocol}").`);
  }
  // node-postgres lets ?host= / ?hostaddr= override the host in the URL, so a
  // "localhost" URL could still point somewhere else. Refuse those outright.
  for (const key of ['host', 'hostaddr']) {
    if (parsed.searchParams.has(key)) {
      throw new Error(`Refusing to seed: DATABASE_URL has a "${key}" query parameter, which can override the host.`);
    }
  }
  const host = parsed.hostname;
  if (!LOCAL_DB_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to seed: DATABASE_URL host is "${host || '(none)'}". ` +
        `The demo seed only runs against ${LOCAL_DB_HOSTS.join(' or ')} (the Docker database).`,
    );
  }
  return host;
}

/**
 * DEMO_PASSWORD is required and must pass the app's own password rule.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function demoPasswordFrom(env = process.env) {
  const pw = env.DEMO_PASSWORD ?? '';
  if (pw.length < MIN_PASSWORD) {
    throw new Error(`DEMO_PASSWORD must be set to at least ${MIN_PASSWORD} characters (see .env.example).`);
  }
  return pw;
}

/** Same format as src/lib/repos/user.ts hashPassword: salt-hex:scrypt64-hex. */
export function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// Rates mirror src/lib/billing/usageRates.ts (Deepgram per second, ElevenLabs per character).
const STT_MICROS_PER_SECOND = (0.0043 / 60) * 1_000_000;
const TTS_MICROS_PER_CHAR = (0.1 / 1_000) * 1_000_000;
// Anthropic $ per million tokens = micros per token (src/lib/billing/usageRates.ts).
const LLM_RATES = { 'claude-sonnet-4-6': { input: 3, output: 15 }, 'claude-haiku-4-5': { input: 1, output: 5 } };

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

/** Monday 00:00 UTC of the ISO week containing `ref` (same rule as summaryRepo.weekBounds). */
function weekStartUtc(ref) {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}
const ymd = (d) => d.toISOString().slice(0, 10);

// Ordered oldest → newest (created_at follows this order). The companion
// retrieves newest-first, so the light favourite-music memory comes up first
// and the sensitive one is oldest. Values are short noun phrases so they read
// naturally both in the family Memories view and in the simulated AI's
// "I remember you mentioned …" line.
const MEMORIES = [
  // [layer, key, value, source, status, sensitivity]
  ['sensitive', 'late_spouse', 'her late husband Frank, who passed away in 2019 (she likes remembering their garden; let her lead)', 'family', 'confirmed', 'sensitive'],
  ['profile', 'preferred_name', 'Mary to her friends, and Gran to the grandkids', 'onboarding', 'confirmed', 'normal'],
  ['profile', 'hometown', 'Dayton, Ohio, where she grew up and lives again now', 'onboarding', 'confirmed', 'normal'],
  ['core', 'career', '31 years teaching third grade at Lincoln Elementary', 'onboarding', 'confirmed', 'normal'],
  ['core', 'grandchildren', 'her three grandchildren, Emma (9), Leo (6) and Ava (3)', 'family', 'confirmed', 'normal'],
  ['interest', 'gardening', 'the tomatoes and roses on her back porch', 'conversation', 'proposed', 'normal'],
  ['episodic', 'school_play', "Leo's school play last week, where he played a very brave tree", 'conversation', 'proposed', 'normal'],
  ['interest', 'favorite_music', 'Ella Fitzgerald and big-band records on Sunday mornings', 'family', 'confirmed', 'normal'],
];

const CONVERSATIONS = [
  {
    mood: 'warm',
    summary: 'Talked about the tomatoes coming in and an Ella Fitzgerald record she played this morning.',
    turns: [
      ['kindly', "Good morning, Mary. I'm Dearly, an AI companion. How are the tomatoes doing?"],
      ['parent', 'Oh, they are finally turning red. I picked three this morning.'],
      ['kindly', 'Three already! What are you going to make with them?'],
      ['parent', 'Just a sandwich, I think. I had Ella on the record player while I did it.'],
      ['kindly', 'That sounds like a lovely morning. Which song was playing?'],
      ['parent', 'Summertime. Frank always hummed along to that one.'],
    ],
  },
  {
    mood: 'warm',
    summary: "Shared how proud she was of Leo in his school play and asked to tell Emma about her new library book.",
    turns: [
      ['kindly', 'Hello again, Mary. Last time you mentioned a school play coming up.'],
      ['parent', 'Yes! Leo was a tree. He stood so still, I was so proud of him.'],
      ['kindly', 'Standing still on stage is harder than it looks. Did he have any lines?'],
      ['parent', 'One line. He said it very loudly. Everybody laughed.'],
      ['kindly', 'It sounds like he stole the show. Would you like to tell the family about it?'],
      ['parent', 'Yes, and tell Emma I started the library book she picked for me.'],
    ],
  },
  {
    mood: 'flat',
    // Family-facing: the skipped meal stays OUT of the summary. It only exists
    // as the internal P2 welfare flag reviewed by staff (see D3 / privacy rules).
    summary: 'A quieter afternoon chat about soup for dinner and calling her sister tonight.',
    turns: [
      ['kindly', 'Hi Mary, it is nice to hear from you this afternoon. How has your day been?'],
      ['parent', "Quiet. I didn't feel like cooking so I skipped lunch."],
      ['kindly', "Some days are like that. Is there something easy in the kitchen you might enjoy later?"],
      ['parent', 'Maybe some soup. I might call my sister tonight.'],
      ['kindly', 'Soup and a call with your sister sound like a good plan. I am glad you thought of her.'],
    ],
  },
];

/**
 * Seed the demo dataset. `q` is any pg-style client with query(text, params).
 * Returns the raw parent talk-link token (shown once; only its hash is stored).
 * @param {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} q
 * @param {{ password?: string, now?: Date }} [opts]
 */
export async function seedDemo(q, { password, now = new Date() } = {}) {
  if (!password) throw new Error('seedDemo: password is required');
  const iso = (d) => d.toISOString();
  const nowMs = now.getTime();

  // ---- users (upsert by email; never deleted) ----
  const upsertUser = async (id, email, fullName, isAdmin) => {
    const { rows } = await q.query(
      // Demo accounts are pre-confirmed so the demo can invite family and send summaries.
      `INSERT INTO users (id, email, full_name, password_hash, auth_provider, is_admin, email_verified_at)
       VALUES ($1, $2, $3, $4, 'email', $5, now())
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             full_name = EXCLUDED.full_name,
             is_admin = EXCLUDED.is_admin,
             email_verified_at = COALESCE(users.email_verified_at, now()),
             deleted_at = NULL
       RETURNING id`,
      [id, email, fullName, hashPassword(password), isAdmin],
    );
    return rows[0].id;
  };
  const demoUserId = await upsertUser(SEED_IDS.demoUser, DEMO_EMAIL, 'Sarah (demo organizer)', false);
  const adminUserId = await upsertUser(SEED_IDS.adminUser, ADMIN_EMAIL, 'Kindly Admin (demo)', true);

  // ---- clear previous demo rows (fixed ids only) ----
  await q.query(`DELETE FROM subscriptions WHERE id = $1 OR beta_invite_id = $2`, [SEED_IDS.subscription, SEED_IDS.betaInvite]);
  await q.query(`DELETE FROM beta_invites WHERE id = $1`, [SEED_IDS.betaInvite]);
  // usage_costs, turns, conversations, memories, consents, flags, summaries,
  // deliveries and talk tokens all cascade from the parent.
  await q.query(`DELETE FROM usage_costs WHERE parent_id = $1`, [SEED_IDS.parent]);
  await q.query(`DELETE FROM summary_deliveries WHERE id = $1 OR summary_id = $2`, [SEED_IDS.delivery, SEED_IDS.summary]);
  await q.query(`DELETE FROM weekly_summaries WHERE parent_id = $1`, [SEED_IDS.parent]);
  await q.query(`DELETE FROM safety_flags WHERE parent_id = $1`, [SEED_IDS.parent]);
  await q.query(`DELETE FROM consents WHERE parent_id = $1`, [SEED_IDS.parent]);
  await q.query(`DELETE FROM parents WHERE id = $1`, [SEED_IDS.parent]);

  // ---- parent (activated) ----
  const created = new Date(nowMs - 10 * DAY);
  await q.query(
    `INSERT INTO parents (id, buyer_id, first_name, pronouns, relationship, city, created_at, activated_at)
     VALUES ($1, $2, $3, 'she/her', 'mother', 'Dayton, OH', $4, $4)`,
    [SEED_IDS.parent, demoUserId, PARENT_FIRST_NAME, iso(created)],
  );

  // ---- consents: buyer attestation, parent conversation, accepted recipient ----
  await q.query(
    `INSERT INTO consents (id, parent_id, kind, granted_by, granted_at, detail) VALUES
       ($1, $4, 'buyer_attestation', $5, $6, $7),
       ($2, $4, 'parent_conversation', NULL, $6, NULL),
       ($3, $4, 'summary_recipient', $5, $6, $8)`,
    [
      SEED_IDS.consentAttestation,
      SEED_IDS.consentParent,
      SEED_IDS.consentRecipient,
      SEED_IDS.parent,
      demoUserId,
      iso(created),
      JSON.stringify({ seeded: true }),
      JSON.stringify({
        recipient_email: RECIPIENT_EMAIL,
        status: 'accepted',
        invite_token_hash: sha256(randomBytes(24).toString('base64url')),
      }),
    ],
  );

  // ---- active beta subscription (no Stripe) ----
  const betaEnds = new Date(nowMs + 14 * DAY);
  await q.query(
    `INSERT INTO beta_invites (id, email_normalized, token_hash, status, expires_at, redeemed_at, redeemed_by_user_id, created_by_user_id)
     VALUES ($1, $2, $3, 'redeemed', $4, $5, $6, $7)`,
    [SEED_IDS.betaInvite, DEMO_EMAIL, sha256(randomBytes(32).toString('base64url')), iso(betaEnds), iso(created), demoUserId, adminUserId],
  );
  await q.query(
    `INSERT INTO subscriptions (id, buyer_id, parent_id, plan, status, current_period_end, beta_invite_id, created_at)
     VALUES ($1, $2, $3, 'family', 'beta', $4, $5, $6)`,
    [SEED_IDS.subscription, demoUserId, SEED_IDS.parent, iso(betaEnds), SEED_IDS.betaInvite, iso(created)],
  );

  // ---- 8 memories across every layer (1 sensitive, 2 proposed) ----
  for (const [i, [layer, key, value, source, status, sensitivity]] of MEMORIES.entries()) {
    await q.query(
      `INSERT INTO memories (id, parent_id, layer, mem_key, mem_value, source, status, sensitivity, created_by, created_at, decay_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        ID(100 + i),
        SEED_IDS.parent,
        layer,
        key,
        value,
        source,
        status,
        sensitivity,
        source === 'conversation' ? null : demoUserId,
        iso(new Date(nowMs - (9 - i) * DAY)),
        layer === 'episodic' ? iso(new Date(nowMs + 30 * DAY)) : null,
      ],
    );
  }

  // ---- 3 ended conversations this week, with turns, summaries and usage costs ----
  const weekStart = weekStartUtc(now);
  const span = nowMs - weekStart.getTime();
  const convIds = [];
  for (const [c, convo] of CONVERSATIONS.entries()) {
    const convId = ID(200 + c);
    convIds.push(convId);
    // Spread across the current week so far, always in the past.
    const startMs = weekStart.getTime() + Math.floor((span * (c + 1)) / (CONVERSATIONS.length + 1));
    const stepMs = Math.max(1000, Math.min(90 * 1000, Math.floor((nowMs - startMs) / (convo.turns.length + 2))));
    const endMs = startMs + stepMs * (convo.turns.length + 1);
    const voiceMinutes = Math.round(((endMs - startMs) / MIN) * 100) / 100;
    await q.query(
      `INSERT INTO conversations (id, parent_id, started_at, ended_at, channel, voice_minutes, summary_text, mood_signal, memories_extracted_at)
       VALUES ($1, $2, $3, $4, 'voice', $5, $6, $7, $4)`,
      [convId, SEED_IDS.parent, iso(new Date(startMs)), iso(new Date(endMs)), voiceMinutes, convo.summary, convo.mood],
    );
    for (const [t, [role, content]] of convo.turns.entries()) {
      const turnId = ID(1000 + c * 100 + t);
      const at = new Date(startMs + stepMs * (t + 1));
      await q.query(
        `INSERT INTO conversation_turns (id, conversation_id, role, content, created_at, retention_purge_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [turnId, convId, role, content, iso(at), iso(new Date(at.getTime() + 30 * DAY))],
      );
      // Parent turns cost speech-to-text seconds; companion turns cost text-to-speech characters.
      const [provider, unit, quantity, rate] =
        role === 'parent'
          ? ['deepgram_stt', 'second', Math.max(2, Math.round(content.split(/\s+/).length / 2.5)), STT_MICROS_PER_SECOND]
          : ['elevenlabs_tts', 'character', content.length, TTS_MICROS_PER_CHAR];
      await q.query(
        `INSERT INTO usage_costs (id, turn_id, conversation_id, parent_id, provider, unit, quantity, unit_rate_micros, cost_micros, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [ID(5000 + c * 100 + t), turnId, convId, SEED_IDS.parent, provider, unit, quantity, rate, Math.round(quantity * rate), iso(at)],
      );
      // A companion reply that answers the parent cost two model calls: the
      // safety scan (small model) and the reply itself. Token counts are typical
      // for this app's prompts, so /admin shows a realistic LLM share.
      if (role === 'kindly' && t > 0 && convo.turns[t - 1][0] === 'parent') {
        const calls = [
          ['scan', 'claude-haiku-4-5', 650, 35, 7000],
          ['reply', 'claude-sonnet-4-6', 1_900, Math.max(20, Math.round(content.length / 4)), 8000],
        ];
        for (const [operation, model, inputTokens, outputTokens, base] of calls) {
          const r = LLM_RATES[model];
          const cost = Math.round(inputTokens * r.input + outputTokens * r.output);
          const total = inputTokens + outputTokens;
          await q.query(
            `INSERT INTO usage_costs (id, turn_id, conversation_id, parent_id, provider, unit, quantity, unit_rate_micros, cost_micros,
                                      input_tokens, output_tokens, model, operation, created_at)
             VALUES ($1, $2, $3, $4, 'anthropic_llm', 'token', $5, $6, $7, $8, $9, $10, $11, $12)`,
            [ID(base + c * 100 + t), turnId, convId, SEED_IDS.parent, total, cost / total, cost, inputTokens, outputTokens, model, operation, iso(at)],
          );
        }
      }
    }
  }

  // ---- P2 welfare safety flag (minimized detail, no transcript) ----
  await q.query(
    `INSERT INTO safety_flags (id, parent_id, conversation_id, severity, status, detail, created_at)
     VALUES ($1, $2, $3, 'p2_welfare', 'open', $4, $5)`,
    [SEED_IDS.flag, SEED_IDS.parent, convIds[2], 'Mentioned skipping a meal (demo data).', iso(now)],
  );

  // ---- this week's summary preview (same wording rules as summaryRepo.preview) ----
  const highlights = CONVERSATIONS.map((c) => `• ${c.summary}`);
  const bodyShort = `${PARENT_FIRST_NAME} had ${CONVERSATIONS.length} conversations with Dearly this week.`;
  const bodyLong = [bodyShort, '', 'Some moments from the week:', ...highlights].join('\n');
  await q.query(
    `INSERT INTO weekly_summaries (id, parent_id, period_start, period_end, status, body_long, body_short, has_concern, generated_at)
     VALUES ($1, $2, $3, $4, 'preview', $5, $6, false, $7)`,
    [SEED_IDS.summary, SEED_IDS.parent, ymd(weekStart), ymd(new Date(weekStart.getTime() + 6 * DAY)), bodyLong, bodyShort, iso(now)],
  );

  // ---- parent talk link: one active token, raw value returned once ----
  const token = randomBytes(32).toString('base64url');
  await q.query(
    `INSERT INTO parent_access_tokens (parent_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [SEED_IDS.parent, sha256(token), iso(new Date(nowMs + 90 * DAY))],
  );

  return { token, demoUserId, adminUserId, parentId: SEED_IDS.parent };
}
