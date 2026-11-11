import {createHmac, randomBytes, scryptSync, timingSafeEqual} from "node:crypto";
import type {NextRequest} from "next/server";
import {q, qOne, type Queryer, defaultQueryer} from "./db.ts";
import {PORTAL_BASE_URL, PORTAL_ALLOWED_ORIGINS, dbConfigured} from "./flags.ts";

export const SESSION_COOKIE = "portal_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export const ROLES = ["super_admin", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];
const WRITE_ROLES: ReadonlySet<string> = new Set(["super_admin", "editor"]);
// viewer (and any future read-only role) can never modify content.
export function canModify(role: string): boolean {
  return WRITE_ROLES.has(role);
}

const getSessionSecret = () => process.env.SESSION_SECRET || "";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, salt, hash] = stored.split(":");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const computed = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return computed.length === expected.length && timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

export function signSessionToken(adminId: number, now = Date.now(), ownerVerified = false): string {
  const secret = getSessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const body = `${ownerVerified ? "v3" : "v2"}.${adminId}.${exp}.${randomBytes(24).toString("base64url")}`;
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string, now = Date.now()): {adminId: number} | null {
  const secret = getSessionSecret();
  if (!secret || !token) return null;
  const parts = token.split(".");
  const legacy = parts[0] === "v1" && parts.length === 4;
  const current = (parts[0] === "v2" || parts[0] === "v3") && parts.length === 5 && /^[A-Za-z0-9_-]{32}$/.test(parts[3]);
  if (!legacy && !current) return null;
  const [, adminIdStr, expStr] = parts;
  const sig = parts.pop()!;
  const adminId = Number(adminIdStr);
  const exp = Number(expStr);
  if (!Number.isSafeInteger(adminId) || adminId <= 0 || !Number.isSafeInteger(exp)) return null;
  const body = parts.join(".");
  const expected = createHmac("sha256", secret).update(body).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, "base64url"); } catch { return null; }
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(expected, given)) return null;
  if (Math.floor(now / 1000) > exp) return null;
  return {adminId};
}

export function sha256Hex(value: string): string {
  return createHmac("sha256", "portal-session").update(value).digest("hex");
}

export type AdminRow = {
  id: number; email: string; role: string; is_active: boolean;
  status?: string; name?: string;
  assigned_section?: string | null; assigned_subjects?: string[] | null; perms?: Record<string, unknown> | null;
};

export async function createSession(adminId: number, db: Queryer = defaultQueryer, ownerVerified = false): Promise<string> {
  const token = signSessionToken(adminId, Date.now(), ownerVerified);
  const exp = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await db.qOne(
    `INSERT INTO portal_sessions (admin_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
    [adminId, sha256Hex(token), exp.toISOString()]
  );
  return token;
}

export async function revokeSession(token: string, db: Queryer = defaultQueryer): Promise<void> {
  await db.qOne(`UPDATE portal_sessions SET revoked_at=now() WHERE token_hash=$1`, [sha256Hex(token)]);
}

export async function getAdminFromToken(token: string, db: Queryer = defaultQueryer): Promise<AdminRow | null> {
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const row = await db.qOne<AdminRow & {revoked: number | null; expired: number}>(
    `SELECT a.*,
            (s.revoked_at IS NOT NULL)::int AS revoked,
            (s.expires_at < now())::int AS expired
     FROM portal_admins a
     JOIN portal_sessions s ON s.admin_id = a.id AND s.token_hash = $1
     WHERE a.is_active = true`,
    [sha256Hex(token)]
  );
  if (!row || row.revoked || row.expired || !row.is_active) return null;
  // suspended accounts (and pending invitations) must never authenticate
  if ((row.status ?? "active") !== "active" || (row.role === "super_admin" && !token.startsWith("v3."))) return null;
  const {revoked, expired, password_hash, ...admin} = row as AdminRow & {revoked: unknown; expired: unknown; password_hash?: string};
  return admin;
}

// CSRF protection for cookie-authenticated state-changing requests:
// cross-site requests cannot set the custom header (no CORS) and their Origin
// will not match the portal origin.
export function csrfWriteOk(req: {headers: {get: (name: string) => string | null}}): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const o = new URL(origin).origin;
      const allowed = new Set([new URL(PORTAL_BASE_URL).origin, ...PORTAL_ALLOWED_ORIGINS.map(u => { try { return new URL(u).origin; } catch { return ""; } })]);
      return allowed.has(o);
    } catch { return false; }
  }
  return req.headers.get("x-portal-admin") === "1";
}

export async function requireAdmin(req: NextRequest, opts?: {write?: boolean}): Promise<AdminRow | null> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie || (opts?.write && !csrfWriteOk(req))) return null;
  try { return await getAdminFromToken(cookie); } catch { return null; }
}

// ---- Login rate limiting ----
// DB-backed (atomic upsert) so it is reliable across Vercel serverless instances;
// in-memory fallback only when no database is configured (local dev/tests).
const loginAttempts = new Map<string, {count: number; resetAt: number}>();
export function checkLoginRateLimitMemory(key: string, limit = 5, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, {count: 1, resetAt: now + windowMs});
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

export async function checkLoginRateLimit(key: string, limit = 5, windowMs = 10 * 60 * 1000, db: Queryer = defaultQueryer): Promise<boolean> {
  if (!dbConfigured()) return checkLoginRateLimitMemory(key, limit, windowMs);
  const row = await db.qOne<{count: number}>(
    `INSERT INTO portal_login_attempts (key, count, reset_at) VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN portal_login_attempts.reset_at < now() THEN 1 ELSE portal_login_attempts.count + 1 END,
       reset_at = CASE WHEN portal_login_attempts.reset_at < now() THEN EXCLUDED.reset_at ELSE portal_login_attempts.reset_at END
     RETURNING count`,
    [key, new Date(Date.now() + windowMs).toISOString()]
  );
  return (row?.count ?? 1) <= limit;
}

export {q, qOne};
