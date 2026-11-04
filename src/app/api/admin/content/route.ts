import {NextRequest, NextResponse} from "next/server";
import {requireAdmin, canModify} from "@/lib/server/auth";
import {listContent, createContent, deleteContent, upsertTelegram, audit, type ContentType} from "@/lib/server/content";
import {withTx} from "@/lib/server/db";
import {dbConfigured} from "@/lib/server/flags";

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
