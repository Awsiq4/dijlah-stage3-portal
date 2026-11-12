import {safeFileUrl} from "../safe-url.ts";
// Shared publishing service — the SAME code path used by the website dashboard
// and by the Telegram bot. All permission checks are enforced here, server-side.
import {withTx, defaultQueryer, type Queryer} from "./db.ts";
import {buildOwnedUpdate, buildUpsert, sanitizeRow, SCHEMAS, type WritableContentType} from "./content-schema.ts";
import {audit} from "./content.ts";
import {canPublishAnnouncement, canPublishSubjectContent, canPublishMaterial, canModifyContent, canManageAllContent, canWriteContentRecord, isActive, type AdminInfo} from "./rbac.ts";
import {checkPublication, indexLegacyPdfFiles, lockPublication, pdfFingerprint, publicationUrl, PublicationConflict, type PublicationIssue, type PublicationKind, type PublicationOptions} from "./publication-dedup.ts";
import {telegramServiceEnabled} from "./flags.ts";

export type PublishOk = {ok: true; id: string; inserted: boolean; action?: "expanded" | "updated"; url?: string; notificationEvents?: number[]};
export type PublishFail = {ok: false; error: string; issue?: PublicationIssue};
export type PublishResult = PublishOk | PublishFail;

const fail = (error: string): PublishFail => ({ok: false, error});

async function insertWithOwnership(
  type: WritableContentType,
  admin: AdminInfo,
  row: Record<string, unknown>,
  source: "web" | "telegram",
  mode: "update" | "nothing",
  options: PublicationOptions = {}, hash: string | null = null
): Promise<PublishOk> {
  return withTx(async tx => {
    let newPublication = false;
    if (type === "announcements" || type === "lectures") {
      const prepared = await preparePublication(tx, admin, type, row, hash, options);
      if (prepared.result) return prepared.result;
      hash = prepared.hash;
      newPublication = !prepared.existing;
      if (prepared.existing && mode === "nothing") return {ok: true, id: String(row.id), inserted: false};
    }
    const {sql, params} = buildUpsert(type, row, mode);
    const res = await tx.q(sql, params);
    const inserted = mode === "nothing" ? res.length > 0 : true;
    // ownership is set ONLY on first insert and can never be spoofed via input
    await tx.q(
      `UPDATE ${SCHEMAS[type].table} SET created_by=$2, source=$3 WHERE id=$1 AND created_by IS NULL`,
      [String(row.id), admin.id, source]
    );
    if (type === "lectures" && (inserted || mode === "update")) {
      await tx.q("UPDATE portal_lectures SET file_sha256=$2 WHERE id=$1", [row.id, hash]);
    }
    await audit(admin.email || `admin#${admin.id}`, `publish.${type}`, {id: row.id, source, role: admin.role}, tx);
    const notificationEvents = inserted && newPublication && telegramServiceEnabled()
      ? await enqueueNewPublication(tx, type, row) : [];
    return {ok: true, id: String(row.id), inserted, notificationEvents} as PublishOk;
  });
}

async function preparePublication(
  db: Queryer, admin: AdminInfo, type: PublicationKind, row: Record<string, unknown>,
  hash: string | null, options: PublicationOptions,
): Promise<{existing: boolean; hash: string | null; result?: PublishOk}> {
  await lockPublication(db, type);
  const existing = await db.qOne<{
    created_by: number; file_url?: string; file_sha256?: string | null; archived_at: string | null;
  } & Record<string, unknown>>(`SELECT * FROM ${SCHEMAS[type].table} WHERE id=$1`, [row.id]);
  if (existing && !canModifyContent(admin, existing)) {
    throw Object.assign(new Error("forbidden: not the owner"), {status: 403});
  }
  const effective = existing ? {...existing, ...row} : row;
  if (type === "lectures" && !hash && existing && effective.file_url === existing.file_url) hash = existing.file_sha256 || null;
  const prepared = {existing: Boolean(existing), hash};
  if (existing?.archived_at || (type === "lectures" && effective.status !== "published")) return prepared;
  const decision = await checkPublication(db, admin, type, effective, hash, existing ? {} : options, !existing);
  if (decision.expanded && decision.addedSections) {
    const {id, title, subject_id} = decision.expanded;
    const notificationEvents: number[] = [];
    if (telegramServiceEnabled()) {
      const {createEvent} = await import("./notify.ts");
      for (const section of decision.addedSections) {
        const event = await createEvent({type: "lecture", refId: id, version: "audience-" + section,
          title, url: publicationUrl("lectures", {id, sections: [section]}), scope: "section", section, subject_id: String(subject_id)}, db);
        if (event.eventId) notificationEvents.push(event.eventId);
      }
    }
    await audit(admin.email || `admin#${admin.id}`, "content.audience_expanded", {id, sections: decision.addedSections}, db);
    return {...prepared, result: {ok: true, id, inserted: false, action: "expanded", url: publicationUrl(type, decision.expanded), notificationEvents}};
  }
  if (decision.replacement) {
    const {id} = decision.replacement;
    if (type === "lectures") {
      await db.q("UPDATE portal_lectures SET title=$2, description=$3, file_url=$4, file_name=$5, updated_at=$6, file_sha256=$7 WHERE id=$1",
        [id, row.title, row.description, row.file_url, row.file_name, row.updated_at, hash]);
    } else {
      await db.q("UPDATE portal_announcements SET title=$2, body=$3 WHERE id=$1", [id, row.title, row.body]);
    }
    await audit(admin.email || `admin#${admin.id}`, "content.update_existing", {type, id}, db);
    return {...prepared, result: {ok: true, id, inserted: false, action: "updated", url: publicationUrl(type, decision.replacement)}};
  }
  return prepared;
}

function handlePublicationConflict(error: unknown): PublishFail {
  if (error instanceof PublicationConflict) return {ok: false, error: error.message, issue: error.issue};
  throw error;
}

async function enqueueNewPublication(db: Queryer, type: WritableContentType, row: Record<string, unknown>) {
  const {createEvent} = await import("./notify.ts");
  const eventIds: number[] = [];
  const enqueue = async (event: Parameters<typeof createEvent>[0]) => {
    const result = await createEvent(event, db);
    if (result.eventId) eventIds.push(result.eventId);
  };
  const refId = String(row.id);
  const title = String(row.title);
  const subject_id = String(row.subject_id || "");
  if (type === "announcements") {
    const scope = row.scope === "teacher" || row.scope === "section" ? row.scope : "general";
    await enqueue({type: "announcement", refId, version: 1, title, body: String(row.body || ""), url: publicationUrl("announcements", {id: refId, section: row.section}),
      scope, section: String(row.section || "all"), subject_id, priority: String(row.priority || "normal")});
  } else if (type === "lectures" && row.status === "published") {
    const sections = Array.isArray(row.sections) && row.sections.length ? [...new Set(row.sections.map(String))] : ["A", "B", "C", "F"];
    const info = {type: "lecture" as const, refId, title, body: String(row.description || ""), url: "/lectures/" + encodeURIComponent(refId), subject_id};
    if (sections.length === 4) await enqueue({...info, version: 1, scope: "general"});
    else for (const section of sections) {
      await enqueue({...info, url: publicationUrl("lectures", {id: refId, sections: [section]}), version: "audience-" + section, scope: "section", section});
    }
  }
  return eventIds;
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
  input: {id?: string; title: string; body?: string; scope: string; section?: string; subjectId?: string; priority?: string; pinned?: boolean; source?: "web" | "telegram"; options?: PublicationOptions}
): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  const scope = input.scope || "general";
  const section = scope === "general" ? "all" : input.section || "all";
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
      subject_id: input.subjectId || "",
      // Public name for the portal owner; login email stays private.
      author: admin.role === "super_admin" ? "Aws Faris" : admin.name || admin.email,
      priority: input.priority || "normal", published_at: new Date().toISOString(), pinned: input.pinned ? "true" : "false",
    });
  } catch (e) { return fail(e instanceof Error ? e.message : "invalid input"); }
  const res = await insertWithOwnership("announcements", admin, row, input.source || "web", input.source === "telegram" ? "nothing" : input.id ? "update" : "nothing", input.options).catch(handlePublicationConflict);
  return res;
}

// ---- lectures ----
export async function publishLecture(
  admin: AdminInfo,
  input: {id?: string; subjectId: string; number: number; title: string; description?: string; fileUrl: string; fileName?: string; sections?: string[]; source?: "web" | "telegram"; options?: PublicationOptions; fingerprint?: string; materialKind?: "lecture" | "summary"}
): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  const ALL = ["A", "B", "C", "F"];
  const sections = input.sections && input.sections.length ? input.sections.map(String) : ALL;
  if (!canPublishMaterial(admin, input.subjectId, sections)) return fail("forbidden: subject or audience not authorized");
  if (!safeFileUrl(input.fileUrl)) return fail("invalid file url");
  const id = input.id || `lec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let row: Record<string, unknown>;
  try {
    row = sanitizeRow("lectures", {
      id, subject_id: input.subjectId, number: input.number, title: input.title,
      material_kind: input.materialKind === "summary" ? "summary" : "lecture",
      description: input.description || "", file_url: input.fileUrl, file_name: input.fileName || input.fileUrl.split("/").pop() || "",
      sections, status: "published", updated_at: new Date().toISOString().slice(0, 10),
    });
  } catch (e) { return fail(e instanceof Error ? e.message : "invalid input"); }
  const [hash] = await Promise.all([
    input.fingerprint || pdfFingerprint(input.fileUrl),
    indexLegacyPdfFiles(input.subjectId),
  ]);
  const res = await insertWithOwnership("lectures", admin, row, input.source || "web", input.source === "telegram" ? "nothing" : input.id ? "update" : "nothing", input.options, hash).catch(handlePublicationConflict);
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
  const res = await insertWithOwnership("exams", admin, row, input.source || "web", input.source === "telegram" ? "nothing" : input.id ? "update" : "nothing");
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
  const res = await insertWithOwnership("assignments", admin, row, input.source || "web", input.source === "telegram" ? "nothing" : input.id ? "update" : "nothing");
  if (res.ok && res.inserted) await notifyIfEnabled({type: "assignment", refId: id, title: String(input.title || ""), url: "/assignments", scope: "general", subject_id: subjectId});
  return res;
}

// Used by /api/admin/content: validates + writes content with ownership taken
// ONLY from the authenticated server-side identity (client-sent created_by/source
// are stripped by the schema allowlist and then overwritten here on first insert).
export async function applyContentUpsert(
  tx: Queryer,
  admin: AdminInfo,
  type: WritableContentType,
  row: Record<string, unknown>,
  source: "web" | "telegram" = "web",
  options: PublicationOptions = {}, hash: string | null = null
): Promise<PublishOk | void> {
  const id = String(row.id);
  const clean = sanitizeRow(type, row);
  if (type === "announcements" && (!clean.scope || clean.scope === "general")) clean.section = "all";
  const scoped = !canManageAllContent(admin.role);
  const owner = scoped ? {id: admin.id, source} : undefined;
  if (!canWriteContentRecord(admin, type, clean)) {
    throw Object.assign(new Error("forbidden: role/scope not authorized for this content"), {status: 403});
  }
  if (scoped) {
    // Use the exact audience authorized above, even when the request omitted it.
    if (type === "lectures" || type === "exams" || type === "assignments") {
      if (!Array.isArray(clean.sections) || !clean.sections.length) clean.sections = ["A", "B", "C", "F"];
    } else if (type === "announcements") {
      clean.scope ||= "general";
      clean.section ||= "all";
    }
  }
  let newPublication = false;
  if (type === "announcements" || type === "lectures") {
    const prepared = await preparePublication(tx, admin, type, clean, hash, options);
    if (prepared.result) return prepared.result;
    hash = prepared.hash;
    newPublication = !prepared.existing;
  }
  if (scoped) {
    const update = buildOwnedUpdate(type, clean, admin.id);
    if (!await tx.qOne(update.sql, update.params)) {
      const insert = buildUpsert(type, clean, "nothing", owner);
      const created = await tx.qOne<{created_by: number}>(insert.sql, insert.params);
      if (!created || String(created.created_by) !== String(admin.id)) {
        throw Object.assign(new Error("forbidden: not the owner or concurrent conflict"), {status: 403});
      }
    }
  } else {
    const upsert = buildUpsert(type, clean);
    await tx.q(upsert.sql, upsert.params);
  }
  if (!scoped && type !== "subjects") {
    const sourceSet = type === "schedule" ? "" : ", source=$3";
    const values = type === "schedule" ? [id, admin.id] : [id, admin.id, source];
    await tx.q(`UPDATE ${SCHEMAS[type].table} SET created_by=$2${sourceSet} WHERE id=$1 AND created_by IS NULL`, values);
  }
  if (type === "lectures") await tx.q("UPDATE portal_lectures SET file_sha256=$2 WHERE id=$1", [id, hash]);
  await audit(admin.email || `admin#${admin.id}`, `content.upsert.${type}`, {id, source}, tx);
  if (newPublication && telegramServiceEnabled()) {
    return {ok: true, id, inserted: true, notificationEvents: await enqueueNewPublication(tx, type, clean)};
  }
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
  if (!canModifyContent(admin, row)) return null; // ownership enforced
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
    await lockPublication(tx, "announcements");
    const row = await loadOwnedRow(tx, admin, "announcements", id);
    if (!row) return fail("forbidden: not found or not yours");
    const title = patch.title ?? String(row.title || "");
    const body = patch.body ?? String(row.body || "");
    await checkPublication(tx, admin, "announcements", {...row, title: title.slice(0, 200), body: body.slice(0, 4000)}, null, {}, false);
    await tx.q(`UPDATE portal_announcements SET title=$2, body=$3 WHERE id=$1`, [id, title.slice(0, 200), body.slice(0, 4000)]);
    await audit(admin.email || `admin#${admin.id}`, "content.edit.announcements", {id}, tx);
    return {ok: true, id, inserted: true} as PublishOk;
  }).catch(handlePublicationConflict);
}

export async function updateLectureMetaOwn(admin: AdminInfo, id: string, patch: {title?: string; description?: string}): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  return withTx(async tx => {
    await lockPublication(tx, "lectures");
    const row = await loadOwnedRow(tx, admin, "lectures", id);
    if (!row) return fail("forbidden: not found or not yours");
    if (patch.title !== undefined) await tx.q(`UPDATE portal_lectures SET title=$2 WHERE id=$1`, [id, patch.title.slice(0, 200)]);
    if (patch.description !== undefined) await tx.q(`UPDATE portal_lectures SET description=$2 WHERE id=$1`, [id, patch.description.slice(0, 2000)]);
    await audit(admin.email || `admin#${admin.id}`, "content.edit.lectures", {id, fields: Object.keys(patch)}, tx);
    return {ok: true, id, inserted: true} as PublishOk;
  });
}

// Replace the PDF file but keep the same content id -> stable website link.
export async function replaceLectureFileOwn(admin: AdminInfo, id: string, fileUrl: string, fileName: string, fingerprint?: string): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  if (!safeFileUrl(fileUrl)) return fail("invalid file url");
  const hash = fingerprint || await pdfFingerprint(fileUrl);
  return withTx(async tx => {
    await lockPublication(tx, "lectures");
    const row = await loadOwnedRow(tx, admin, "lectures", id);
    if (!row) return fail("forbidden: not found or not yours");
    if (!row.archived_at && row.status === "published") {
      await checkPublication(tx, admin, "lectures", {...row, file_url: fileUrl}, hash, {}, false);
    }
    await tx.q(`UPDATE portal_lectures SET file_url=$2, file_name=$3, updated_at=$4, file_sha256=$5 WHERE id=$1`, [id, fileUrl, fileName.slice(0, 120), new Date().toISOString().slice(0, 10), hash]);
    await audit(admin.email || `admin#${admin.id}`, "content.replace_file.lectures", {id}, tx);
    return {ok: true, id, inserted: true} as PublishOk;
  }).catch(handlePublicationConflict);
}

export async function archiveContent(admin: AdminInfo, type: "announcements" | "lectures", id: string, archive: boolean): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  return withTx(async tx => {
    await lockPublication(tx, type);
    const row = await loadOwnedRow(tx, admin, type, id);
    if (!row) return fail("forbidden: not found or not yours");
    if (!archive && (type === "announcements" || row.status === "published")) {
      await checkPublication(tx, admin, type, row, typeof row.file_sha256 === "string" ? row.file_sha256 : null, {}, false);
    }
    const table = SCHEMAS[type].table;
    await tx.q(`UPDATE ${table} SET archived_at=$2 WHERE id=$1`, [id, archive ? new Date().toISOString() : null]);
    await audit(admin.email || `admin#${admin.id}`, archive ? "content.archive" : "content.unarchive", {type, id}, tx);
    return {ok: true, id, inserted: true} as PublishOk;
  }).catch(handlePublicationConflict);
}

// Hard delete of the content ROW only — the stored file is never cascaded away.
export async function deleteOwnContent(admin: AdminInfo, type: "announcements" | "lectures", id: string): Promise<PublishResult> {
  if (!isActive(admin)) return fail("account is not active");
  return withTx(async tx => {
    await lockPublication(tx, type);
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
