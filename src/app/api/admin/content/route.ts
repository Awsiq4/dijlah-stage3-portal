import {after, NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";
import {listContent, deleteContent, upsertTelegram, audit, SCHEMAS, type ContentType} from "@/lib/server/content";
import {qOne, withTx} from "@/lib/server/db";
import {dbConfigured} from "@/lib/server/flags";
import {canModifyContent, canManageAllContent, canUseTelegramPublishing, canWriteContentRecord} from "@/lib/server/rbac";
import {indexLegacyPdfFiles, pdfFingerprint, lockPublication, PublicationConflict} from "@/lib/server/publication-dedup";
import {sanitizeRow} from "@/lib/server/content-schema";
import {drainQueue} from "@/lib/server/notify";
import {applyContentUpsert, archiveContent, publicationQueuesTelegram} from "@/lib/server/publish";

import {archiveCoursework, changeCoursework} from "@/lib/server/bot-coursework-manage";

export const dynamic = "force-dynamic";

const TYPES: ContentType[] = ["subjects", "lectures", "announcements", "exams", "assignments", "schedule", "telegram"];

class ForbiddenError extends Error {}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  const type = new URL(req.url).searchParams.get("type") as ContentType | null;
  if (!type || !TYPES.includes(type)) return NextResponse.json({error: "invalid type"}, {status: 400});
  const privileged = canManageAllContent(admin.role);
  if (!privileged && (!canUseTelegramPublishing(admin) || type === "subjects" || type === "telegram" || type === "schedule")) {
    return NextResponse.json({error: "forbidden"}, {status: 403});
  }
  const rows = await listContent(type, undefined, privileged ? undefined : admin.id);
  return NextResponse.json({type, fromDatabase: dbConfigured(), rows});
}

// State-changing: unified role-aware gate (canWriteContentRecord) + CSRF-safe origin.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  const body = await req.json().catch(() => null);
  if (!body || !TYPES.includes(body.type)) return NextResponse.json({error: "invalid type"}, {status: 400});
  if (body.type !== "telegram" && (!body.row || typeof body.row !== "object" || !body.row.id)) {
    return NextResponse.json({error: "row.id required"}, {status: 400});
  }
  try {
    if (body.preview === true) {
      const type: unknown = body.type;
      if (type !== "lectures" && type !== "announcements" && type !== "assignments" && type !== "exams") {
        return NextResponse.json({error: "المعاينة غير متاحة لهذا القسم."}, {status: 400});
      }
      const clean = sanitizeRow(type, body.row);
      if (type === "announcements" && (!clean.scope || clean.scope === "general")) clean.section = "all";
      if (!canWriteContentRecord(admin, type, clean)) throw new ForbiddenError("المحتوى خارج صلاحيات حسابك.");
      const existing = await qOne<{created_by: number | null; status?: string; archived_at?: string | null}>(
        `SELECT created_by${type === "lectures" ? ", status, archived_at" : ""} FROM ${SCHEMAS[type].table} WHERE id=$1`, [clean.id]);
      if (existing && !canModifyContent(admin, existing)) throw new ForbiddenError("المحتوى خارج صلاحيات حسابك.");
      if (!canManageAllContent(admin.role) && type !== "announcements" && (!Array.isArray(clean.sections) || !clean.sections.length)) {
        clean.sections = ["A", "B", "C", "F"];
      }
      const startsPublication = !existing || (type === "lectures" && existing.status === "draft" && !existing.archived_at);
      const queuesTelegram = startsPublication && publicationQueuesTelegram(type, clean);
      return NextResponse.json({
        queuesTelegram,
        pendingDeduplication: queuesTelegram && (type === "lectures" || type === "announcements"),
      });
    }
    const lecture = body.type === "lectures" ? sanitizeRow("lectures", body.row) : null;
    const [hash] = lecture && canWriteContentRecord(admin, "lectures", lecture)
      ? await Promise.all([pdfFingerprint(String(lecture.file_url || "")), indexLegacyPdfFiles(String(lecture.subject_id || ""))])
      : [null];
    const options = Object.fromEntries(["expand", "reviewed", "replace"].flatMap(key => {
      const value = body.publication?.[key];
      return typeof value === "string" && value.length <= 128 ? [[key, value]] : [];
    }));
    const result = await withTx(async db => {
      if (body.type === "telegram") {
        if (!canManageAllContent(admin.role)) throw new ForbiddenError("forbidden");
        await upsertTelegram(String(body.kind || ""), String(body.key || ""), String(body.url || ""), db);
        await audit(admin.email || `admin#${admin.id}`, "content.upsert.telegram", {key: body.key}, db);
      } else {
        // ownership + source are set server-side from the session identity only
        return applyContentUpsert(db, admin, body.type, body.row, "web", options, hash);
      }
    });
    if (!result) return NextResponse.json({ok: true});
    const {notificationEvents, ...publication} = result;
    if (notificationEvents?.length) after(() => drainQueue(200, notificationEvents).then(() => undefined));
    return NextResponse.json(publication);
  } catch (err) {
    if (err instanceof PublicationConflict) return NextResponse.json({error: err.message, issue: err.issue}, {status: 409});
    const e = err as Error & {status?: number};
    if (err instanceof ForbiddenError || e.status === 403) return NextResponse.json({error: e.message}, {status: 403});
    const msg = e.message || "error";
    const status = e.status === 400 || /مطلوب|غير صالح|JSON|قيمة غير مسموحة|تعذّر التحقق/.test(msg) ? 400 : 500;
    return NextResponse.json({error: status === 400 ? msg : "Server error"}, {status});
  }
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (!admin) return NextResponse.json({error: "جلسة الدخول غير متاحة."}, {status: 401});
  if (!dbConfigured()) return NextResponse.json({error: "تعذّر الاتصال بقاعدة البيانات."}, {status: 503});
  const body = await req.json().catch(() => null);
  const {type, id, action} = body || {};
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(id) ||
      !["assignments", "exams", "lectures", "announcements"].includes(type) ||
      !["archive", "restore", "quick-edit"].includes(action)) {
    return NextResponse.json({error: "الطلب غير صالح."}, {status: 400});
  }
  try {
    if (action === "quick-edit") {
      if ((type !== "assignments" && type !== "exams") || typeof body.value !== "string" || typeof body.expected !== "string") {
        return NextResponse.json({error: "التعديل السريع غير متاح لهذا الحقل."}, {status: 400});
      }
      const result = await changeCoursework(admin, type === "assignments" ? "a" : "q", id,
        type === "assignments" ? "due_at" : "status", body.value, body.expected, "web");
      return NextResponse.json(result, {status: result.ok ? 200 : 409});
    }
    const archive = action === "archive";
    const result = type === "lectures" || type === "announcements"
      ? await archiveContent(admin, type, id, archive)
      : await archiveCoursework(admin, type === "assignments" ? "a" : "q", id, archive, "web");
    if (result.ok) return NextResponse.json({ok: true});
    const error = result.error.startsWith("forbidden") ? "المنشور غير موجود أو خارج صلاحيات حسابك." : result.error;
    return NextResponse.json({error}, {status: 409});
  } catch {
    return NextResponse.json({error: "تعذّر إكمال العملية."}, {status: 500});
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") as ContentType | null;
  const id = sp.get("id") || "";
  if (!type || !TYPES.includes(type) || type === "telegram" || !id) return NextResponse.json({error: "invalid request"}, {status: 400});
  try {
    await withTx(async db => {
      if (type === "lectures" || type === "announcements" || type === "exams") await lockPublication(db, type);
      const table = (SCHEMAS as Record<string, {table: string}>)[type]?.table;
      if (!table) throw new ForbiddenError("forbidden");
      if (type === "exams" && admin.role !== "super_admin") {
        const exam = await db.qOne<{type: string}>("SELECT type FROM portal_exams WHERE id=$1 FOR UPDATE", [id]);
        if (exam && exam.type !== "كوز يومي") throw new ForbiddenError("جدول امتحانات الجامعة من صلاحيات المالك.");
      }
      if (!canManageAllContent(admin.role)) {
        if (!canUseTelegramPublishing(admin) || type === "subjects" || type === "schedule") throw new ForbiddenError("forbidden");
        const row = await db.qOne<{created_by: number | null}>(`SELECT created_by FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
        if (!row || !canModifyContent(admin, row)) throw new ForbiddenError("forbidden: not the owner");
      }
      await deleteContent(type, id, db);
      await audit(admin.email || `admin#${admin.id}`, `content.delete.${type}`, {id}, db);
    });
    return NextResponse.json({ok: true});
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({error: err.message}, {status: 403});
    const msg = err instanceof Error ? err.message : "error";
    const status = /غير صالح/.test(msg) ? 400 : 500;
    return NextResponse.json({error: status === 400 ? msg : "Server error"}, {status});
  }
}
