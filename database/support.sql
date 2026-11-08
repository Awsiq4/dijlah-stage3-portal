-- Unified support: additive, repeatable, isolated from academic data.
CREATE TABLE IF NOT EXISTS support_identities (
 id TEXT PRIMARY KEY, secret_hash TEXT UNIQUE, telegram_id BIGINT UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_links (
 token_hash TEXT PRIMARY KEY, identity_id TEXT NOT NULL REFERENCES support_identities(id),
 expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS support_grants (
 admin_id BIGINT PRIMARY KEY REFERENCES portal_admins(id), permissions JSONB NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS support_tickets (
 id BIGSERIAL PRIMARY KEY, identity_id TEXT NOT NULL REFERENCES support_identities(id),
 category TEXT NOT NULL CHECK(category IN ('support','idea','problem')),
 subject TEXT NOT NULL, section TEXT CHECK(section IS NULL OR section IN ('A','B','C','F')),
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','awaiting','progress','resolved','closed')),
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('normal','important','urgent')),
 source TEXT NOT NULL CHECK(source IN ('web','telegram')), request_key TEXT NOT NULL,
 assigned_to BIGINT REFERENCES portal_admins(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), first_response_at TIMESTAMPTZ,
 resolved_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, reopened INTEGER NOT NULL DEFAULT 0,
 UNIQUE(identity_id,request_key)
);
CREATE TABLE IF NOT EXISTS support_messages (
 id BIGSERIAL PRIMARY KEY, ticket_id BIGINT NOT NULL REFERENCES support_tickets(id),
 author TEXT NOT NULL, body TEXT NOT NULL, internal BOOLEAN NOT NULL DEFAULT false,
 request_key TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(ticket_id,author,request_key)
);
CREATE TABLE IF NOT EXISTS support_attachments (
 id TEXT PRIMARY KEY, message_id BIGINT NOT NULL REFERENCES support_messages(id),
 name TEXT NOT NULL, mime TEXT NOT NULL, bytes BYTEA NOT NULL,
 CHECK(octet_length(bytes) <= 2097152)
);
CREATE TABLE IF NOT EXISTS support_history (
 id BIGSERIAL PRIMARY KEY, ticket_id BIGINT REFERENCES support_tickets(id),
 actor TEXT NOT NULL, action TEXT NOT NULL, detail JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support_jobs (
 id BIGSERIAL PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, recipient BIGINT NOT NULL,
 ticket_id BIGINT NOT NULL REFERENCES support_tickets(id), text TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, next_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 sent_at TIMESTAMPTZ, failed BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS support_drafts (
 chat_id BIGINT PRIMARY KEY, data JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS support_tickets_identity_idx ON support_tickets(identity_id,updated_at);
CREATE INDEX IF NOT EXISTS support_tickets_filter_idx ON support_tickets(status,category,section,created_at);
CREATE INDEX IF NOT EXISTS support_messages_ticket_idx ON support_messages(ticket_id,id);
CREATE INDEX IF NOT EXISTS support_jobs_due_idx ON support_jobs(sent_at,failed,next_at);
