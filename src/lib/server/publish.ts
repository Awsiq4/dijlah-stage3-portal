// Shared publishing service — the SAME code path used by the website dashboard
// and by the Telegram bot. All permission checks are enforced here, server-side.
import {withTx, defaultQueryer} from "./db.ts";
import {buildUpsert, sanitizeRow, SCHEMAS, type WritableContentType} from "./content-schema.ts";
import {audit} from "./content.ts";
import {canPublishAnnouncement, canPublishSubjectContent, canPublishMaterial, canModifyContent, canManageAllContent, isActive, type AdminInfo} from "./rbac.ts";
import {telegramServiceEnabled} from "./flags.ts";

export type PublishOk = {ok: true; id: string; inserted: boolean};
export type PublishFail = {ok: false; error: string};
export type PublishResult = PublishOk | PublishFail;

const fail = (error: string): PublishFail => ({ok: false, error});

async function insertWithOwnership(
  type: WritableContentType,
  admin: AdminInfo,
  row: Record<string, unknown>,
  source: "web" | "telegram",
  mode: "update" | "nothing"
): Promise<PublishOk> {
  return withTx(async tx => {
    const {sql, params} = buildUpsert(type, row, mode);
    const res = await tx.q(sql, params);
    const inserted = mode === "nothing" ? res.length > 0 : true;
    // ownership is set ONLY on first insert and can never be spoofed via input
    await tx.q(
      `UPDATE ${SCHEMAS[type].table} SET created_by=$2, source=$3 WHERE id=$1 AND created_by IS NULL`,
      [String(row.id), admin.id, source]
    );
    await audit(admin.email || `admin#${admin.id}`, `publish.${type}`, {id: row.id, source, role: admin.role}, tx);
    return {ok: true, id: String(row.id), inserted} as PublishOk;
  });
}

async function notifyIfEnabled(input: {
  type: "lecture" | "exam" | "announcement" | "schedule" | "assignment";
  refId: string; title: string; body?: string; url?: string;
  scope: "general" | "section" | "teacher"; section?: string; subject_id?: string; priority?: string;
}): Promise<void> {
  if (!telegramServiceEnabled()) return; // bot disabled -> record nothing, send nothing
  try {
    const {createEvent} = await import("./notify.ts");
    await createEvent({...input, version: 1});
  } catch { /* notifications must never break publishing */ }
}

// ---- announcements ----
export async function publishAnnouncement(
  admin: AdminInfo,
  input: {id?: string; title: string; body?: string; scope: string; section?: string; subjectId?: string; priority?: string; pinned?: boolean; source?: "web" | "telegram"}
): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  const scope = input.scope || "general";
  const section = input.section || "all";
  if (scope === "teacher") {
    if (!input.subjectId || !canPublishSubjectContent(admin, input.subjectId, section === "all" ? ["A", "B", "C", "F"] : [section])) {
      return fail("forbidden: subject or section not authorized");
    }
  } else if (!canPublishAnnouncement(admin, scope, section)) {
    return fail("forbidden: role cannot publish this announcement scope/section");
  }
  const id = input.id || `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let row: Record<string, unknown>;
  try {
    row = sanitizeRow("announcements", {
      id, title: input.title, body: input.body || "", scope, section,
      subject_id: input.subjectId || "", author: admin.name || admin.email,
      priority: input.priority || "normal", published_at: new Date().toISOString(), pinned: input.pinned ? "true" : "false",
    });
  } catch (e) { return fail(e instanceof Error ? e.message : "invalid input"); }
  const res = await insertWithOwnership("announcements", admin, row, input.source || "web", input.id ? "update" : "nothing");
  if (res.ok && res.inserted) {
    await notifyIfEnabled({type: "announcement", refId: id, title: input.title, body: input.body, url: "/announcements", scope: scope as "general", section, subject_id: input.subjectId, priority: input.priority});
  }
  return res;
}

// ---- lectures ----
export async function publishLecture(
  admin: AdminInfo,
  input: {id?: string; subjectId: string; number: number; title: string; description?: string; fileUrl: string; fileName?: string; sections?: string[]; source?: "web" | "telegram"}
): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  const ALL = ["A", "B", "C", "F"];
  const sections = input.sections && input.sections.length ? input.sections.map(String) : ALL;
  if (!canPublishMaterial(admin, input.subjectId, sections)) return fail("forbidden: subject or audience not authorized");
  if (!/^\/[A-Za-z0-9_\-./]+$/.test(input.fileUrl) && !/^https:\/\//.test(input.fileUrl)) return fail("invalid file url");
  const id = input.id || `lec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let row: Record<string, unknown>;
  try {
    row = sanitizeRow("lectures", {
      id, subject_id: input.subjectId, number: input.number, title: input.title,
      description: input.description || "", file_url: input.fileUrl, file_name: input.fileName || input.fileUrl.split("/").pop() || "",
      sections, status: "published", updated_at: new Date().toISOString().slice(0, 10),
    });
  } catch (e) { return fail(e instanceof Error ? e.message : "invalid input"); }
  const res = await insertWithOwnership("lectures", admin, row, input.source || "web", input.id ? "update" : "nothing");
  if (res.ok && res.inserted) {
    const isAll = ALL.every(x => sections.includes(x));
    await notifyIfEnabled({type: "lecture", refId: id, title: input.title, body: input.description, url: `/subjects/${input.subjectId}`, scope: isAll ? "general" : "section", section: isAll ? undefined : sections[0], subject_id: input.subjectId});
  }
  return res;
}

// ---- exams / assignments (subject-scoped) ----
export async function publishExam(admin: AdminInfo, input: Record<string, unknown> & {subjectId?: string; sections?: string[]; source?: "web" | "telegram"}): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  const subjectId = String(input.subjectId || "");
  const sections = input.sections && (input.sections as string[]).length ? (input.sections as string[]) : ["A", "B", "C", "F"];
  if (subjectId && !canPublishSubjectContent(admin, subjectId, sections)) return fail("forbidden: subject or sections not authorized");
  if (!canPublishSubjectContent(admin, subjectId, sections) && !["super_admin", "editor"].includes(admin.role)) return fail("forbidden");
  const id = String(input.id || `exam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  let row: Record<string, unknown>;
  try { row = sanitizeRow("exams", {...input, id, sections: input.sections || ["A", "B", "C", "F"]}); } catch (e) { return fail(e instanceof Error ? e.message : "invalid input"); }
  const res = await insertWithOwnership("exams", admin, row, input.source || "web", input.id ? "update" : "nothing");
  if (res.ok && res.inserted) await notifyIfEnabled({type: "exam", refId: id, title: String(input.title || ""), url: "/exams", scope: "general", subject_id: subjectId});
  return res;
}

export async function publishAssignment(admin: AdminInfo, input: Record<string, unknown> & {subjectId?: string; sections?: string[]; source?: "web" | "telegram"}): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  const subjectId = String(input.subjectId || "");
  const sections = input.sections && (input.sections as string[]).length ? (input.sections as string[]) : ["A", "B", "C", "F"];
  if (!canPublishSubjectContent(admin, subjectId, sections)) return fail("forbidden: subject or sections not authorized");
  const id = String(input.id || `asg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  let row: Record<string, unknown>;
  try { row = sanitizeRow("assignments", {...input, id, sections: input.sections || ["A", "B", "C", "F"]}); } catch (e) { return fail(e instanceof Error ? e.message : "invalid input"); }
  const res = await insertWithOwnership("assignments", admin, row, input.source || "web", input.id ? "update" : "nothing");
  if (res.ok && res.inserted) await notifyIfEnabled({type: "assignment", refId: id, title: String(input.title || ""), url: "/assignments", scope: "general", subject_id: subjectId});
  return res;
}

// Used by /api/admin/content: validates + writes content with ownership taken
// ONLY from the authenticated server-side identity (client-sent created_by/source
// are stripped by the schema allowlist and then overwritten here on first insert).
export async function applyContentUpsert(
  tx: {q: import("./db.ts").Queryer["q"]; qOne: import("./db.ts").Queryer["qOne"]},
  admin: AdminInfo,
  type: WritableContentType,
  row: Record<string, unknown>,
  source: "web" | "telegram" = "web"
): Promise<void> {
  const id = String(row.id);
  // update of an existing row requires ownership (privileged roles bypass)
  if (!canManageAllContent(admin.role)) {
    const table = SCHEMAS[type].table;
    const existing = await tx.qOne<{created_by: number | null}>(`SELECT created_by FROM ${table} WHERE id=$1`, [id]);
    if (existing && !canModifyContent(admin, existing)) {
      const err = new Error("forbidden: not the owner") as Error & {status?: number};
      err.status = 403;
      throw err;
    }
  }
  const {sql, params} = buildUpsert(type, row, "update");
  await tx.q(sql, params);
  // set ownership only when the row is new (never overwrite an existing owner)
  await tx.q(
    `UPDATE ${SCHEMAS[type].table} SET created_by=$2, source=$3 WHERE id=$1 AND created_by IS NULL`,
    [id, admin.id, source]
  );
  await audit(admin.email || `admin#${admin.id}`, `content.upsert.${type}`, {id, source}, tx);
}

// ownership-aware update/delete for the admin content API
export function canEditRow(admin: AdminInfo, row: {created_by?: number | null}): boolean {
  return canModifyContent(admin, row);
}

export {defaultQueryer};
