// Shared publishing service — the SAME code path used by the website dashboard
// and by the Telegram bot. All permission checks are enforced here, server-side.
import {withTx, defaultQueryer, type Queryer} from "./db.ts";
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

// ================= content management (shared by dashboard API and bot) =================
// Every mutation re-checks: account active, ownership, and (for writes) scope.

async function loadOwnedRow(db: {qOne: Queryer["qOne"]}, admin: AdminInfo, type: WritableContentType, id: string): Promise<Record<string, unknown> | null> {
  const table = SCHEMAS[type].table;
  const row = await db.qOne<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  if (!row) return null;
  if (!canManageAllContent(admin.role) && row.created_by !== admin.id) return null; // ownership enforced
  return row;
}

export async function listOwnContent(admin: AdminInfo, type: "announcements" | "lectures", page = 0, perPage = 5): Promise<{rows: Record<string, unknown>[]; total: number}> {
  const table = SCHEMAS[type].table;
  const privileged = canManageAllContent(admin.role);
  const where = privileged ? "" : "WHERE created_by=$1";
  const base: unknown[] = privileged ? [] : [admin.id];
  const total = (await defaultQueryer.qOne<{c: number}>(`SELECT count(*)::int AS c FROM ${table} ${where}`, base))?.c || 0;
  const rows = await defaultQueryer.q(
    `SELECT * FROM ${table} ${where} ORDER BY id DESC LIMIT $${base.length + 1} OFFSET $${base.length + 2}`,
    [...base, perPage, page * perPage]
  );
  return {rows, total};
}

export async function updateAnnouncementOwn(admin: AdminInfo, id: string, patch: {title?: string; body?: string}): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  return withTx(async tx => {
    const row = await loadOwnedRow(tx, admin, "announcements", id);
    if (!row) return fail("forbidden: not found or not yours");
    const title = patch.title ?? String(row.title || "");
    const body = patch.body ?? String(row.body || "");
    await tx.q(`UPDATE portal_announcements SET title=$2, body=$3 WHERE id=$1`, [id, title.slice(0, 200), body.slice(0, 4000)]);
    await audit(admin.email || `admin#${admin.id}`, "content.edit.announcements", {id}, tx);
    return {ok: true, id, inserted: true} as PublishOk;
  });
}

export async function updateLectureMetaOwn(admin: AdminInfo, id: string, patch: {title?: string; description?: string}): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  return withTx(async tx => {
    const row = await loadOwnedRow(tx, admin, "lectures", id);
    if (!row) return fail("forbidden: not found or not yours");
    if (patch.title !== undefined) await tx.q(`UPDATE portal_lectures SET title=$2 WHERE id=$1`, [id, patch.title.slice(0, 200)]);
    if (patch.description !== undefined) await tx.q(`UPDATE portal_lectures SET description=$2 WHERE id=$1`, [id, patch.description.slice(0, 2000)]);
    await audit(admin.email || `admin#${admin.id}`, "content.edit.lectures", {id, fields: Object.keys(patch)}, tx);
    return {ok: true, id, inserted: true} as PublishOk;
  });
}

// Replace the PDF file but keep the same content id -> stable website link.
export async function replaceLectureFileOwn(admin: AdminInfo, id: string, fileUrl: string, fileName: string): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  if (!/^\/[A-Za-z0-9_\-./]+$/.test(fileUrl) && !/^https:\/\//.test(fileUrl)) return fail("invalid file url");
  return withTx(async tx => {
    const row = await loadOwnedRow(tx, admin, "lectures", id);
    if (!row) return fail("forbidden: not found or not yours");
    await tx.q(`UPDATE portal_lectures SET file_url=$2, file_name=$3, updated_at=$4 WHERE id=$1`, [id, fileUrl, fileName.slice(0, 120), new Date().toISOString().slice(0, 10)]);
    await audit(admin.email || `admin#${admin.id}`, "content.replace_file.lectures", {id}, tx);
    return {ok: true, id, inserted: true} as PublishOk;
  });
}

export async function archiveContent(admin: AdminInfo, type: "announcements" | "lectures", id: string, archive: boolean): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  return withTx(async tx => {
    const row = await loadOwnedRow(tx, admin, type, id);
    if (!row) return fail("forbidden: not found or not yours");
    const table = SCHEMAS[type].table;
    await tx.q(`UPDATE ${table} SET archived_at=$2 WHERE id=$1`, [id, archive ? new Date().toISOString() : null]);
    await audit(admin.email || `admin#${admin.id}`, archive ? "content.archive" : "content.unarchive", {type, id}, tx);
    return {ok: true, id, inserted: true} as PublishOk;
  });
}

// Hard delete of the content ROW only — the stored file is never cascaded away.
export async function deleteOwnContent(admin: AdminInfo, type: "announcements" | "lectures", id: string): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  return withTx(async tx => {
    const row = await loadOwnedRow(tx, admin, type, id);
    if (!row) return fail("forbidden: not found or not yours");
    const table = SCHEMAS[type].table;
    await tx.q(`DELETE FROM ${table} WHERE id=$1`, [id]);
    await audit(admin.email || `admin#${admin.id}`, "content.delete.own", {type, id, title: row.title}, tx);
    return {ok: true, id, inserted: true} as PublishOk;
  });
}

// schedule changes generate a notification event (type schedule)
export async function notifyScheduleChange(subjectId: string, section: string): Promise<void> {
  await notifyIfEnabled({type: "schedule", refId: `sched-${section}-${new Date().toISOString().slice(0, 10)}`, title: `تغيير في جدول شعبة ${section}`, url: "/schedule", scope: "section", section});
}
