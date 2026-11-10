// Pure RBAC + token helpers (no DB imports — unit-testable under node).
import {createHash, randomBytes, timingSafeEqual} from "node:crypto";

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

const ALL_SECTIONS = ["A", "B", "C", "F"];

// Lecture materials & booklets (portal_lectures) audience rules:
//  - super_admin/editor: any subject, any audience
//  - general_representative: any subject; all sections or one section
//  - section_representative: any subject; audience must be exactly [own section] OR all sections
//  - teacher: assigned subjects only; sections limited by teacher_sections mapping
export function canPublishMaterial(a: AdminInfo, subjectId: string, targetSections: string[]): boolean {
  if (!isActive(a)) return false;
  if (canManageAllContent(a.role)) return true;
  const secs = targetSections.length ? targetSections.map(String) : ALL_SECTIONS;
  if (!secs.every(s => ALL_SECTIONS.includes(s))) return false;
  if (a.role === "general_representative") return true; // any subject, all or single section
  if (a.role === "section_representative") {
    const isOwn = secs.length === 1 && secs[0] === a.assigned_section;
    const isAll = ALL_SECTIONS.every(s => secs.includes(s));
    return isOwn || isAll;
  }
  if (a.role === "teacher") return canPublishSubjectContent(a, subjectId, secs);
  return false;
}

// Unified write gate for the admin content API: privileged roles write anything;
// reps/teachers are limited by scope/subject rules. Used by /api/admin/content.
export function canWriteContentRecord(a: AdminInfo, type: string, row?: Record<string, unknown>): boolean {
  if (!isActive(a)) return false;
  if (type === "telegram") return canManageAllContent(a.role);
  if (canManageAllContent(a.role)) return true;
  if (!row) return false;
  if (type === "announcements") return canPublishAnnouncement(a, String(row.scope || "general"), String(row.section || "all"));
  if (type === "lectures") {
    const sections = Array.isArray(row.sections) && row.sections.length ? row.sections.map(String) : ["A", "B", "C", "F"];
    return canPublishMaterial(a, String(row.subject_id || ""), sections);
  }
  if (type === "exams" || type === "assignments") {
    const sections = Array.isArray(row.sections) && row.sections.length ? row.sections.map(String) : ["A", "B", "C", "F"];
    return canPublishSubjectContent(a, String(row.subject_id || ""), sections);
  }
  return false; // schedule etc.: privileged roles only
}

// Ownership: non-privileged roles may only modify content they created.
export function canModifyContent(a: AdminInfo, row: {created_by?: number | null}): boolean {
  if (!isActive(a)) return false;
  if (canManageAllContent(a.role)) return true;
  return canUseTelegramPublishing(a) && String(row.created_by) === String(a.id);
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

// Telegram deep-link start parameter must stay <= 64 chars total, so the link
// carries ONLY a short random token:  /start link_<token>   (token = 16 base64url chars)
export function newLinkToken(): string {
  return randomBytes(12).toString("base64url"); // 16 chars
}
export function linkStartParam(token: string): string {
  return `link_${token}`;
}
export function linkStartParamLength(token: string): number {
  return linkStartParam(token).length;
}

