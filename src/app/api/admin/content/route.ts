import {NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";
import {listContent, createContent, deleteContent, upsertTelegram, audit, type ContentType} from "@/lib/server/content";
import {dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

const TYPES: ContentType[] = ["subjects", "lectures", "announcements", "exams", "assignments", "schedule", "telegram"];

function deny() {
  return NextResponse.json({error: "forbidden"}, {status: 403});
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  const type = new URL(req.url).searchParams.get("type") as ContentType | null;
  if (!type || !TYPES.includes(type)) return NextResponse.json({error: "invalid type"}, {status: 400});
  const rows = await listContent(type);
  return NextResponse.json({type, fromDatabase: dbConfigured(), rows});
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return deny();
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  const body = await req.json().catch(() => null);
  if (!body || !TYPES.includes(body.type)) return NextResponse.json({error: "invalid type"}, {status: 400});
  try {
    if (body.type === "telegram") {
      await upsertTelegram(body.kind, String(body.key || ""), String(body.url || ""));
    } else {
      if (!body.row || !body.row.id) return NextResponse.json({error: "row.id required"}, {status: 400});
      await createContent(body.type, body.row);
    }
    await audit(admin.email, `content.upsert.${body.type}`, {id: body.row?.id || body.key});
    return NextResponse.json({ok: true});
  } catch (err) {
    return NextResponse.json({error: err instanceof Error ? err.message : "error"}, {status: 500});
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return deny();
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") as ContentType | null;
  const id = sp.get("id") || "";
  if (!type || !TYPES.includes(type) || type === "telegram" || !id) return NextResponse.json({error: "invalid request"}, {status: 400});
  await deleteContent(type, id);
  await audit(admin.email, `content.delete.${type}`, {id});
  return NextResponse.json({ok: true});
}
