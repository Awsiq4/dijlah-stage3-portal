import {NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";
import {listContent, deleteContent, upsertTelegram, audit, SCHEMAS, type ContentType} from "@/lib/server/content";
import {withTx} from "@/lib/server/db";
import {dbConfigured} from "@/lib/server/flags";
import {canModifyContent, canManageAllContent, canUseTelegramPublishing, canWriteContentRecord} from "@/lib/server/rbac";
import {indexLegacyPdfFiles, pdfFingerprint, lockPublication, PublicationConflict} from "@/lib/server/publication-dedup";
import {sanitizeRow} from "@/lib/server/content-schema";
import {applyContentUpsert} from "@/lib/server/publish";

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
    return NextResponse.json(result || {ok: true});
  } catch (err) {
    if (err instanceof PublicationConflict) return NextResponse.json({error: err.message, issue: err.issue}, {status: 409});
    const e = err as Error & {status?: number};
    if (err instanceof ForbiddenError || e.status === 403) return NextResponse.json({error: e.message}, {status: 403});
    const msg = e.message || "error";
    const status = /مطلوب|غير صالح|JSON|قيمة غير مسموحة|تعذّر التحقق/.test(msg) ? 400 : 500;
    return NextResponse.json({error: status === 400 ? msg : "Server error"}, {status});
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
      if (type === "lectures" || type === "announcements") await lockPublication(db, type);
      const table = (SCHEMAS as Record<string, {table: string}>)[type]?.table;
      if (!table) throw new ForbiddenError("forbidden");
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
