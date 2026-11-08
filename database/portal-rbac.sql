-- Phase 2 RBAC + Telegram publishing migration (PostgreSQL / Neon)
-- Idempotent: every statement is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS. Never destructive.
-- Apply: psql "$DATABASE_URL" -f database/portal-rbac.sql   (or via Neon MCP prepare/apply flow)

-- ---------- portal_admins: extended account model ----------
ALTER TABLE portal_admins ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE portal_admins ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('invited','active','suspended'));
ALTER TABLE portal_admins ADD COLUMN IF NOT EXISTS assigned_section TEXT
  CHECK (assigned_section IS NULL OR assigned_section IN ('A','B','C','F'));
ALTER TABLE portal_admins ADD COLUMN IF NOT EXISTS assigned_subjects JSONB NOT NULL DEFAULT '[]';
ALTER TABLE portal_admins ADD COLUMN IF NOT EXISTS perms JSONB NOT NULL DEFAULT '{}';
-- extend allowed roles (drop + re-add keeps it idempotent)
ALTER TABLE portal_admins DROP CONSTRAINT IF EXISTS portal_admins_role_check;
ALTER TABLE portal_admins ADD CONSTRAINT portal_admins_role_check
  CHECK (role IN ('super_admin','editor','viewer','general_representative','section_representative','teacher'));

-- ---------- content ownership + publication source ----------
ALTER TABLE portal_announcements ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES portal_admins(id);
ALTER TABLE portal_announcements ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','telegram'));
ALTER TABLE portal_lectures ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES portal_admins(id);
ALTER TABLE portal_lectures ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','telegram'));
ALTER TABLE portal_exams ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES portal_admins(id);
ALTER TABLE portal_exams ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','telegram'));
ALTER TABLE portal_assignments ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES portal_admins(id);
ALTER TABLE portal_assignments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','telegram'));
ALTER TABLE portal_schedule ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES portal_admins(id);

-- ---------- invitations (one-time, hashed token, expiring) ----------
CREATE TABLE IF NOT EXISTS portal_invitations (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  assigned_section TEXT,
  assigned_subjects JSONB NOT NULL DEFAULT '[]',
  perms JSONB NOT NULL DEFAULT '{}',
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES portal_admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_invitations_email ON portal_invitations (email);

-- ---------- one-time Telegram account-linking tokens ----------
CREATE TABLE IF NOT EXISTS portal_link_tokens (
  token_hash TEXT PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES portal_admins(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Telegram account links (admin <-> telegram user) ----------
CREATE TABLE IF NOT EXISTS portal_telegram_links (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES portal_admins(id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL UNIQUE,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_portal_telegram_links_admin ON portal_telegram_links (admin_id);

-- ---------- persistent bot conversation state (survives serverless restarts) ----------
CREATE TABLE IF NOT EXISTS portal_bot_state (
  chat_id BIGINT PRIMARY KEY,
  flow TEXT,
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 minutes'
);

-- ---------- lecture materials audience (booklets/PDFs) ----------
-- single record, shared audience, one canonical URL; legacy rows default to all sections
ALTER TABLE portal_lectures ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '["A","B","C","F"]'::jsonb
  CHECK (sections <@ '["A","B","C","F"]'::jsonb);

-- ---------- soft archive (recoverable delete) ----------
ALTER TABLE portal_announcements ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE portal_lectures ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE portal_exams ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE portal_assignments ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
