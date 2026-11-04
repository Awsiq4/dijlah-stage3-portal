import {NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";
import {q} from "@/lib/server/db";
import {dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!dbConfigured()) return NextResponse.json({databaseConfigured: false});
  const counts = await Promise.all(
    ["portal_subjects", "portal_lectures", "portal_announcements", "portal_exams", "portal_assignments", "portal_schedule", "tg_subscribers", "tg_events", "tg_deliveries"].map(async t => {
      const r = await q<{c: number}>(`SELECT count(*)::int AS c FROM ${t}`);
      return {table: t, count: r[0]?.c ?? 0};
    })
  );
  const recent = await q(`SELECT actor, action, created_at FROM portal_audit ORDER BY id DESC LIMIT 15`);
  return NextResponse.json({databaseConfigured: true, counts, recentAudit: recent});
}
