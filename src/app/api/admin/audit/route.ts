import {NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";
import {canManageUsers} from "@/lib/server/rbac";
import {q} from "@/lib/server/db";
import {dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

// GET: recent audit log (super_admin only). Read-only; never returns secrets.
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!canManageUsers(admin.role)) return NextResponse.json({error: "forbidden: super_admin only"}, {status: 403});
  if (!dbConfigured()) return NextResponse.json({fromDatabase: false, rows: []});
  const sp = new URL(req.url).searchParams;
  const requested = Number(sp.get("limit") || 100);
  if (!Number.isSafeInteger(requested) || requested < 1) return NextResponse.json({error: "invalid limit"}, {status: 400});
  const limit = Math.min(requested, 500);
  const rows = await q(
    `SELECT id, actor, action, detail, created_at FROM portal_audit ORDER BY id DESC LIMIT $1`,
    [limit]
  );
  return NextResponse.json({fromDatabase: true, rows});
}
