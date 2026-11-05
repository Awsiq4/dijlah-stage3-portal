import {NextRequest, NextResponse} from "next/server";
import {requireAdmin, canModify} from "@/lib/server/auth";
import {listContent, createContent, deleteContent, upsertTelegram, audit, type ContentType} from "@/lib/server/content";
import {withTx, qOne} from "@/lib/server/db";
import {dbConfigured} from "@/lib/server/flags";
import {canPublishAnnouncement, canPublishSubjectContent, canModifyContent, canManageAllContent} from "@/lib/server/rbac";

// Non-privileged roles (reps/teachers) are restricted by scope + ownership, server-side.
function writeAllowed(admin: {role: string; id: number; assigned_section?: string | null; assigned_subjects?: string[] | null; perms?: Record<string, unknown> | null}, type: string, row?: Record<string, unknown>): boolean {
  if (canManageAllContent(admin.role)) return true;
  if (type === "announcements" && row) return canPublishAnnouncement(admin, String(row.scope || "general"), String(row.section || "all"));
  if ((type === "lectures" || type === "exams" || type === "assignments") && row) {
    const sections = Array.isArray(row.sections) && row.sections.length ? row.sections.map(String) : ["A", "B", "C", "F"];
    return canPublishSubjectContent(admin, String(row.subject_id || ""), sections);
  }
  return false; // schedule changes and other types: privileged roles only
}

export const dynamic = "force-dynamic";

const TYPES: ContentType[] = ["subjects", "lectures", "announcements", "exams", "assignments", "schedule", "telegram"];

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  const type = new URL(req.url).searchParams.get("type") as ContentType | null;
  if (!type || !TYPES.includes(type)) return NextResponse.json({error: "invalid type"}, {status: 400});
  const rows = await listContent(type);
  return NextResponse.json({type, fromDatabase: dbConfigured(), rows});
}

// State-changing: requires write role (super_admin/editor) + CSRF-safe origin when cookie-authenticated.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!canModify(admin.role)) return NextResponse.json({error: "forbidden: role cannot modify content"}, {status: 403});
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  const body = await req.json().catch(() => null);
  if (!body || !TYPES.includes(body.type)) return NextResponse.json({error: "invalid type"}, {status: 400});
  if (body.type !== "telegram" && (!body.row || typeof body.row !== "object" || !body.row.id)) {
    return NextResponse.json({error: "row.id required"}, {status: 400});
  }
  if (body.type !== "telegram" && !writeAllowed(admin, body.type, body.row)) {
    return NextResponse.json({error: "forbidden: role/scope not authorized for this content"}, {status: 403});
  }
  try {
    await withTx(async db => {
      if (body.type === "telegram") {
        await upsertTelegram(String(body.kind || ""), String(body.key || ""), String(body.url || ""), db);
        await audit(admin.email, "content.upsert.telegram", {key: body.key}, db);
      } else {
        await createContent(body.type, body.row, db);
        await audit(admin.email, `content.upsert.${body.type}`, {id: body.row.id}, db);
      }
    });
    return NextResponse.json({ok: true});
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    const status = /مطلوب|غير صالح|JSON|قيمة غير مسموحة/.test(msg) ? 400 : 500;
    return NextResponse.json({error: msg}, {status});
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!canModify(admin.role)) return NextResponse.json({error: "forbidden: role cannot modify content"}, {status: 403});
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") as ContentType | null;
  const id = sp.get("id") || "";
  if (!type || !TYPES.includes(type) || type === "telegram" || !id) return NextResponse.json({error: "invalid request"}, {status: 400});
  if (!canManageAllContent(admin.role)) {
    // ownership check: only the creator (or a privileged role) may delete
    const row = await qOne<{created_by: number | null}>(`SELECT created_by FROM ${({subjects: "portal_subjects", lectures: "portal_lectures", announcements: "portal_announcements", exams: "portal_exams", assignments: "portal_assignments", schedule: "portal_schedule"})[type as string]} WHERE id=$1`, [id]);
    if (!row || !canModifyContent(admin, row)) return NextResponse.json({error: "forbidden: not the owner"}, {status: 403});
  }
  try {
    await withTx(async db => {
      await deleteContent(type, id, db);
      await audit(admin.email, `content.delete.${type}`, {id}, db);
    });
    return NextResponse.json({ok: true});
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    const status = /غير صالح/.test(msg) ? 400 : 500;
    return NextResponse.json({error: msg}, {status});
  }
}
