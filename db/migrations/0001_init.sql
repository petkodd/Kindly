-- ============================================================
-- Kindly — Database Schema v1 (Alpha v0.1)
-- PostgreSQL 15+ with pgvector
-- Owner: Backend Dev · Reviewers: Privacy Advisor, Security Engineer
-- Principles: per-parent isolation, data minimization, consent-gated,
--             encryption at rest (handled at column/disk layer), hard-delete path.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "vector";     -- pgvector for memory retrieval

-- ---------- ENUMS ----------
CREATE TYPE relationship_t      AS ENUM ('mother','father','grandparent','aunt','uncle','other');
CREATE TYPE plan_t              AS ENUM ('founding','family','premium','gift_3mo','trial');
CREATE TYPE subscription_status AS ENUM ('trialing','active','past_due','canceled');
CREATE TYPE memory_layer_t      AS ENUM ('profile','core','interest','episodic','sensitive');
CREATE TYPE memory_source_t     AS ENUM ('onboarding','conversation','family');
CREATE TYPE memory_status_t     AS ENUM ('proposed','confirmed','retired');
CREATE TYPE sensitivity_t       AS ENUM ('normal','sensitive','restricted');
CREATE TYPE consent_kind_t      AS ENUM ('buyer_attestation','parent_conversation','summary_recipient');
CREATE TYPE flag_severity_t     AS ENUM ('p0_crisis','p1_acute_medical','p2_welfare','p3_abuse');
CREATE TYPE flag_status_t       AS ENUM ('open','reviewing','resolved','dismissed');
CREATE TYPE channel_t           AS ENUM ('email','sms');
CREATE TYPE summary_status_t    AS ENUM ('draft','preview','sent');

-- ---------- USERS (buyers + family recipients) ----------
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT UNIQUE NOT NULL,
  full_name       TEXT,
  auth_provider   TEXT NOT NULL DEFAULT 'email',  -- 'email' | 'magic_link' | provider
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ,
  is_admin        BOOLEAN NOT NULL DEFAULT false,
  deleted_at      TIMESTAMPTZ                       -- soft-delete marker; hard-delete job purges
);

-- ---------- PARENTS (the older adult; the product subject) ----------
CREATE TABLE parents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_name         TEXT NOT NULL,
  pronouns           TEXT,
  relationship       relationship_t NOT NULL,
  city               TEXT,
  language           TEXT NOT NULL DEFAULT 'en-US',
  -- accessibility prefs
  large_text         BOOLEAN NOT NULL DEFAULT true,
  voice_first        BOOLEAN NOT NULL DEFAULT true,
  speech_rate        TEXT NOT NULL DEFAULT 'slow', -- 'slow'|'normal'
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at       TIMESTAMPTZ,                  -- set only after consent gate passes
  deleted_at         TIMESTAMPTZ
);
CREATE INDEX idx_parents_buyer ON parents(buyer_id);

-- ---------- PARENT ACCESS TOKENS (passwordless talk link) ----------
CREATE TABLE parent_access_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,              -- store hash, never raw token
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,                       -- nullable = long-lived
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX idx_pat_parent ON parent_access_tokens(parent_id);

-- ---------- CONSENT (gates activation + recipients) ----------
CREATE TABLE consents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  kind          consent_kind_t NOT NULL,
  granted_by    UUID REFERENCES users(id),         -- null for parent_conversation (in-app)
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  detail        JSONB                              -- e.g. {"recipient_email":"..."}
);
CREATE INDEX idx_consents_parent_kind ON consents(parent_id, kind);

-- ---------- MEMORIES (structured, approved, isolated) ----------
CREATE TABLE memories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  layer         memory_layer_t NOT NULL,
  mem_key       TEXT NOT NULL,                     -- e.g. 'late_spouse','favorite_music'
  mem_value     TEXT NOT NULL,
  source        memory_source_t NOT NULL,
  status        memory_status_t NOT NULL DEFAULT 'proposed',
  sensitivity   sensitivity_t NOT NULL DEFAULT 'normal',
  embedding     vector(1536),                      -- nullable until embedded
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  decay_at      TIMESTAMPTZ                         -- episodic expiry; null = no decay
);
CREATE INDEX idx_memories_parent_status ON memories(parent_id, status);
CREATE INDEX idx_memories_parent_layer  ON memories(parent_id, layer);
-- ANN index for retrieval (cosine). Build after seed data exists.
CREATE INDEX idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ---------- CONVERSATIONS + TURNS ----------
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  channel         TEXT NOT NULL DEFAULT 'voice',   -- 'voice'|'text'
  voice_minutes   NUMERIC(8,2) NOT NULL DEFAULT 0, -- for cost-per-minute
  summary_text    TEXT,                            -- per-conversation summary
  mood_signal     TEXT                             -- coarse, non-clinical: 'warm'|'flat'|'low'|null
);
CREATE INDEX idx_conv_parent ON conversations(parent_id, started_at DESC);

CREATE TABLE conversation_turns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,                   -- 'parent'|'kindly'
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_purge_at TIMESTAMPTZ                   -- transcript retention limit
);
CREATE INDEX idx_turns_conv ON conversation_turns(conversation_id, created_at);

-- ---------- SAFETY FLAGS ----------
CREATE TABLE safety_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  severity        flag_severity_t NOT NULL,
  status          flag_status_t NOT NULL DEFAULT 'open',
  detail          TEXT,                            -- minimized; no full transcript
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES users(id)
);
CREATE INDEX idx_flags_status ON safety_flags(status, severity, created_at);

-- ---------- WEEKLY SUMMARIES ----------
CREATE TABLE weekly_summaries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  status          summary_status_t NOT NULL DEFAULT 'draft',
  body_long       TEXT,                            -- email version
  body_short      TEXT,                            -- sms-style version
  has_concern     BOOLEAN NOT NULL DEFAULT false,  -- respectful heads-up flag
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_id, period_start)
);

CREATE TABLE summary_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_id      UUID NOT NULL REFERENCES weekly_summaries(id) ON DELETE CASCADE,
  recipient_user  UUID REFERENCES users(id),
  channel         channel_t NOT NULL,
  consent_id      UUID NOT NULL REFERENCES consents(id),  -- delivery requires consent
  sent_at         TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending'   -- 'pending'|'sent'|'failed'
);

-- ---------- BILLING ----------
CREATE TABLE subscriptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id          UUID REFERENCES parents(id) ON DELETE SET NULL,
  plan               plan_t NOT NULL,
  status             subscription_status NOT NULL DEFAULT 'trialing',
  stripe_customer_id TEXT,
  stripe_sub_id      TEXT,
  current_period_end TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subs_buyer ON subscriptions(buyer_id);

-- ---------- REFERRALS ----------
CREATE TABLE referrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,
  redeemed_by     UUID REFERENCES users(id),
  redeemed_at     TIMESTAMPTZ,
  household_hash  TEXT,                            -- fraud guard: one redemption per household
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- WAITLIST / DEMO (public funnel) ----------
CREATE TABLE waitlist_signups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT NOT NULL,
  source_page     TEXT,                            -- which slug captured them
  utm             JSONB,
  wants_demo      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_waitlist_created ON waitlist_signups(created_at DESC);

-- ---------- AUDIT LOG (all admin/sensitive reads) ----------
CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  actor_id        UUID REFERENCES users(id),
  action          TEXT NOT NULL,                   -- 'view_parent','view_flag','export', etc.
  target_type     TEXT NOT NULL,
  target_id       UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta            JSONB
);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at DESC);

-- ---------- ANALYTICS EVENTS (server-side mirror) ----------
CREATE TABLE analytics_events (
  id              BIGSERIAL PRIMARY KEY,
  event_name      TEXT NOT NULL,
  user_id         UUID,
  parent_id       UUID,
  props           JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_name_time ON analytics_events(event_name, created_at DESC);

-- ============================================================
-- ISOLATION NOTE: All parent-scoped queries MUST filter by parent_id
-- derived from the authenticated buyer (or a valid access token).
-- Row-Level Security to be enabled in a follow-up migration once
-- the auth->parent mapping is wired (tracked in feature/parent-profile).
-- ============================================================
