-- Portal persistent content + admin auth schema (PostgreSQL / Neon on Vercel)
-- Idempotent: safe to re-run. Telegram tables live in database/telegram-notifications.sql.
-- Apply: psql "$DATABASE_URL" -f database/portal-schema.sql

-- ---------- Admin accounts & sessions ----------
CREATE TABLE IF NOT EXISTS portal_admins (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin','editor','viewer')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS portal_sessions (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT NOT NULL REFERENCES portal_admins(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_admin ON portal_sessions (admin_id);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_expires ON portal_sessions (expires_at);

-- ---------- Portal content (migrated from verified seed; unique ids = idempotent upsert) ----------
CREATE TABLE IF NOT EXISTS portal_subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  english_name TEXT NOT NULL DEFAULT '',
  teacher TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#3586d9',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_lectures (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES portal_subjects(id) ON DELETE CASCADE,
  number INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL DEFAULT '',
  material_kind TEXT NOT NULL DEFAULT 'lecture' CHECK (material_kind IN ('lecture','summary')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('published','draft')),
  updated_at TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'general' CHECK (scope IN ('general','section','teacher')),
  section TEXT NOT NULL DEFAULT 'all',
  subject_id TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','important','urgent')),
  published_at TEXT NOT NULL DEFAULT '',
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_exams (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  start_time TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL DEFAULT '',
  sections JSONB NOT NULL DEFAULT '[]',
  topics TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'provisional' CHECK (status IN ('confirmed','provisional','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_assignments (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  assigned_at TEXT NOT NULL DEFAULT '',
  due_at TEXT NOT NULL DEFAULT '',
  sections JSONB NOT NULL DEFAULT '[]',
  submission TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','cancelled')),
  attachment_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_schedule (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('A','B','C','F')),
  day INT NOT NULL CHECK (day BETWEEN 0 AND 6),
  start TEXT NOT NULL,
  "end" TEXT NOT NULL,  -- quoted: END is a reserved word in PostgreSQL
  subject_id TEXT NOT NULL DEFAULT '',
  teacher TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'theory' CHECK (kind IN ('theory','practical')),
  status TEXT NOT NULL DEFAULT 'normal' CHECK (status IN ('normal','moved','cancelled','extra')),
  note TEXT NOT NULL DEFAULT '',
  periods JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_schedule_section_day ON portal_schedule (section, day);

CREATE TABLE IF NOT EXISTS portal_telegram (
  kind TEXT NOT NULL CHECK (kind IN ('general','section','subject')),
  key TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (kind, key)
);

-- ---------- Login rate limiting (DB-backed so it works across serverless instances) ----------
CREATE TABLE IF NOT EXISTS portal_login_attempts (
  key TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 1,
  reset_at TIMESTAMPTZ NOT NULL
);

-- ---------- Audit ----------
CREATE TABLE IF NOT EXISTS portal_audit (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
