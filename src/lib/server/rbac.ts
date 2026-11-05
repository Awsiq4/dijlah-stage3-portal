// Pure RBAC + token helpers (no DB imports — unit-testable under node).
import {createHash, createHmac, randomBytes, timingSafeEqual} from "node:crypto";

export const ROLES = ["super_admin", "editor", "viewer", "general_representative", "section_representative", "teacher"] as const;
export type Role = (typeof ROLES)[number];
export const SECTIONS = ["A", "B", "C", "F"] as const;
export type Section = (typeof SECTIONS)[number];

export interface AdminInfo {
  id: number;
  email?: string;
  role: string;
  is_active?: boolean;
  status?: string;               // invited | active | suspended
  name?: string;
  assigned_section?: string | null;
  assigned_subjects?: string[] | null;
  perms?: Record<string, unknown> | null;
}

export const isActive = (a: AdminInfo): boolean =>
  a.is_active !== false && (a.status ?? "active") === "active";

export const canManageUsers = (role: string): boolean => role === "super_admin";
export const canManageAllContent = (role: string): boolean => role === "super_admin" || role === "editor";
export const canViewAdmin = (role: string): boolean => (ROLES as readonly string[]).includes(role);

// Which sections a teacher may publish to for a subject.
// perms.teacher_sections = { [subjectId]: ["A","B"] }; absent mapping = all sections.
export function teacherSections(a: AdminInfo, subjectId: string): Section[] | null {
  const map = (a.perms?.teacher_sections ?? null) as Record<string, string[]> | null;
  if (!map || !map[subjectId]) return null;
  return map[subjectId].filter((s): s is Section => (SECTIONS as readonly string[]).includes(s));
}

// Announcement publishing rules (enforced server-side only).
export function canPublishAnnouncement(a: AdminInfo, scope: string, section: string): boolean {
  if (!isActive(a)) return false;
  switch (a.role) {
    case "super_admin":
    case "editor":
      return true;
    case "general_representative":
      return scope === "general";
    case "section_representative":
      return scope === "section" && a.assigned_section === section;
    case "teacher":
      return false; // teachers publish subject-scoped announcements via canPublishSubjectContent
    default:
      return false;
  }
}

// Subject content (lectures/exams/assignments/teacher announcements).
export function canPublishSubjectContent(a: AdminInfo, subjectId: string, targetSections: string[]): boolean {
  if (!isActive(a)) return false;
  if (canManageAllContent(a.role)) return true;
  if (a.role !== "teacher") return false;
  const subjects = a.assigned_subjects || [];
  if (!subjects.includes(subjectId)) return false;
  const allowed = teacherSections(a, subjectId);
  if (!allowed) return true; // no explicit mapping -> all sections
  return targetSections.every(s => allowed.includes(s as Section));
}

// Ownership: non-privileged roles may only modify content they created.
export function canModifyContent(a: AdminInfo, row: {created_by?: number | null}): boolean {
  if (!isActive(a)) return false;
  if (canManageAllContent(a.role)) return true;
  return row.created_by === a.id;
}

// Telegram publishing requires an active linked account of a publishing role.
export const PUBLISHER_ROLES: readonly string[] = ["super_admin", "editor", "general_representative", "section_representative", "teacher"];
export const canUseTelegramPublishing = (a: AdminInfo): boolean => isActive(a) && PUBLISHER_ROLES.includes(a.role);

// ---- one-time tokens (invitations & telegram links) ----
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function tokenMatches(token: string, storedHash: string): boolean {
  try {
    const a = Buffer.from(hashToken(token), "hex");
    const b = Buffer.from(storedHash, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}
export function tokenUsable(opts: {expires_at: string; used_at: string | null}, now = Date.now()): boolean {
  return !opts.used_at && new Date(opts.expires_at).getTime() > now;
}

// HMAC-signed short-lived link token payload (deep link), e.g. link_<hmac>.<exp>
export function signLinkPayload(adminId: number, tokenHash: string, secret: string, ttlSeconds: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const body = `link.${adminId}.${tokenHash}.${exp}`;
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyLinkPayload(payload: string, secret: string, now = Date.now()): {adminId: number; tokenHash: string} | null {
  if (!secret) return null;
  const parts = payload.split(".");
  if (parts.length !== 5 || parts[0] !== "link") return null;
  const [, adminIdStr, tokenHash, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Math.floor(now / 1000) > exp) return null;
  const body = `link.${adminIdStr}.${tokenHash}.${expStr}`;
  const expected = createHmac("sha256", secret).update(body).digest();
  let given: Buffer;
  try { given = Buffer.from(sig, "base64url"); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(expected, given)) return null;
  return {adminId: Number(adminIdStr), tokenHash};
}
