-- Cloudflare D1 / SQLite draft schema, NOT deployed; review migrations and backfills first.
-- Auth/session implementation must be handled securely by a server-side auth provider.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, english_name TEXT NOT NULL DEFAULT '',
  teacher_display TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#3586d9', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY, auth_subject TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('super_admin','editor','general_rep','section_rep','teacher')),
  section TEXT CHECK(section IN ('A','B','C','F')), subject_id TEXT REFERENCES subjects(id),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lectures (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subjects(id), number INTEGER NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft'
  CHECK(status IN ('draft','published')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lecture_files (
  id TEXT PRIMARY KEY, lecture_id TEXT NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL, original_name TEXT NOT NULL, mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size>=0), version_no INTEGER NOT NULL,
  sha256 TEXT, created_by TEXT REFERENCES admin_users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(lecture_id, version_no)
);
CREATE TABLE IF NOT EXISTS schedule_slots (
  id TEXT PRIMARY KEY, section TEXT NOT NULL CHECK(section IN ('A','B','C','F')),
  day INTEGER NOT NULL CHECK(day BETWEEN 0 AND 6), start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES subjects(id), teacher TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL CHECK(kind IN ('theory','practical')),
  status TEXT NOT NULL DEFAULT 'normal' CHECK(status IN ('normal','moved','cancelled','extra')),
  note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS exams (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subjects(id), title TEXT NOT NULL,
  type TEXT NOT NULL, exam_date TEXT NOT NULL, start_time TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '', topics TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'provisional' CHECK(status IN ('confirmed','provisional','cancelled')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS exam_sections (
  exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK(section IN ('A','B','C','F')),
  PRIMARY KEY(exam_id,section)
);
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('general','section','teacher')),
  section TEXT CHECK(section IN ('A','B','C','F')),
  subject_id TEXT REFERENCES subjects(id), author_id TEXT REFERENCES admin_users(id),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','important','urgent')),
  content_type TEXT NOT NULL DEFAULT 'general', is_pinned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','scheduled','published','archived')),
  scheduled_at TEXT, published_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subjects(id), title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '', assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_at TEXT NOT NULL, submission TEXT NOT NULL DEFAULT '', attachment_key TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed','cancelled'))
);
CREATE TABLE IF NOT EXISTS assignment_sections (
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK(section IN ('A','B','C','F')),
  PRIMARY KEY(assignment_id,section)
);
CREATE TABLE IF NOT EXISTS telegram_subscribers (
  id TEXT PRIMARY KEY, telegram_chat_id TEXT NOT NULL UNIQUE, section TEXT CHECK(section IN ('A','B','C','F')),
  subscribed INTEGER NOT NULL DEFAULT 1, joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notification_jobs (
  id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL, entity_id TEXT NOT NULL, target_section TEXT,
  payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
  CHECK(status IN ('pending','sending','sent','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0, next_run_at TEXT, last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_index_jobs (
  id TEXT PRIMARY KEY, lecture_file_id TEXT NOT NULL REFERENCES lecture_files(id),
  status TEXT NOT NULL DEFAULT 'pending', error TEXT, indexed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY, visitor_hash TEXT, subject_id TEXT REFERENCES subjects(id),
  tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, actor_id TEXT REFERENCES admin_users(id), action TEXT NOT NULL,
  resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_schedule_section_day ON schedule_slots(section,day,start_time);
CREATE INDEX IF NOT EXISTS idx_announcements_scope ON announcements(status,scope,section,published_at);
CREATE INDEX IF NOT EXISTS idx_lectures_subject ON lectures(subject_id,number);
CREATE INDEX IF NOT EXISTS idx_exams_date ON exams(exam_date,status);
CREATE INDEX IF NOT EXISTS idx_assignment_due ON assignments(due_at,status);
CREATE INDEX IF NOT EXISTS idx_notifications_state ON notification_jobs(status,next_run_at);
