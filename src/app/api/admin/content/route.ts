import {NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";
import {listContent, createContent, deleteContent, upsertTelegram, audit, SCHEMAS, type ContentType} from "@/lib/server/content";
import {withTx, qOne} from "@/lib/server/db";
import {dbConfigured} from "@/lib/server/flags";
import {canWriteContentRecord, canModifyContent, canManageAllContent, type AdminInfo} from "@/lib/server/rbac";

export const dynamic = "force-dynamic";

const TYPES: ContentType[] = ["subjects", "lectures", "announcements", "exams", "assignments", "schedule", "telegram"];

class ForbiddenError extends Error {}

// Ownership check for UPDATES, executed inside the same transaction as the write.
async function assertUpdateAllowed(tx: {qOne: typeof qOne}, admin: AdminInfo, type: string, id: string): Promise<void> {
  if (canManageAllContent(admin.role)) return;
  const table = (SCHEMAS as Record<string, {table: string}>)[type]?.table;
  if (!table) throw new ForbiddenError("forbidden");
  const existing = await tx.qOne<{created_by: number | null}>(`SELECT created_by FROM ${table} WHERE id=$1`, [id]);
  if (!existing) return; // insert path — handled by canWriteContentRecord
  if (!canModifyContent(admin, existing)) throw new ForbiddenError("forbidden: not the owner");
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  const type = new URL(req.url).searchParams.get("type") as ContentType | null;
  if (!type || !TYPES.includes(type)) return NextResponse.json({error: "invalid type"}, {status: 400});
  const rows = await listContent(type);
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
  if (!canWriteContentRecord(admin, body.type, body.type === "telegram" ? undefined : body.row)) {
    return NextResponse.json({error: "forbidden: role/scope not authorized for this content"}, {status: 403});
  }
  try {
    await withTx(async db => {
      if (body.type === "telegram") {
        await upsertTelegram(String(body.kind || ""), String(body.key || ""), String(body.url || ""), db);
        await audit(admin.email || `admin#${admin.id}`, "content.upsert.telegram", {key: body.key}, db);
      } else {
        await assertUpdateAllowed(db, admin, body.type, String(body.row.id));
        await createContent(body.type, body.row, db);
        await audit(admin.email || `admin#${admin.id}`, `content.upsert.${body.type}`, {id: body.row.id}, db);
      }
    });
    return NextResponse.json({ok: true});
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({error: err.message}, {status: 403});
    const msg = err instanceof Error ? err.message : "error";
    const status = /مطلوب|غير صالح|JSON|قيمة غير مسموحة/.test(msg) ? 400 : 500;
    return NextResponse.json({error: msg}, {status});
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
      const table = (SCHEMAS as Record<string, {table: string}>)[type]?.table;
      if (!table) throw new ForbiddenError("forbidden");
      if (!canManageAllContent(admin.role)) {
        const row = await db.qOne<{created_by: number | null}>(`SELECT created_by FROM ${table} WHERE id=$1`, [id]);
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
    return NextResponse.json({error: msg}, {status});
  }
}
