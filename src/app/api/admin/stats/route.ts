import {NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";
import {canManageAllContent, canManageUsers} from "@/lib/server/rbac";
import {q} from "@/lib/server/db";
import {dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!canManageAllContent(admin.role)) return NextResponse.json({error: "forbidden"}, {status: 403});
  if (!dbConfigured()) return NextResponse.json({databaseConfigured: false});
  if (req.nextUrl.searchParams.get("view") === "recent") {
    const recentPublications = await q(
      `SELECT type, id, title FROM (
         SELECT 'lectures' AS type, id, title, created_at FROM portal_lectures WHERE status='published' AND archived_at IS NULL
         UNION ALL
         SELECT 'announcements', id, title, created_at FROM portal_announcements WHERE archived_at IS NULL
         UNION ALL
         SELECT 'assignments', id, title, created_at FROM portal_assignments WHERE archived_at IS NULL
         UNION ALL
         SELECT CASE WHEN type='كوز يومي' THEN 'exams' ELSE 'examSchedule' END, id, title, created_at
           FROM portal_exams WHERE archived_at IS NULL AND ($1 OR type='كوز يومي')
       ) AS publications ORDER BY created_at DESC, id DESC LIMIT 8`,
      [canManageUsers(admin.role)]
    );
    return NextResponse.json({databaseConfigured: true, recentPublications});
  }
  const counts = await Promise.all(
    ["portal_subjects", "portal_lectures", "portal_announcements", "portal_exams", "portal_assignments", "portal_schedule", "tg_subscribers", "tg_events", "tg_deliveries"].map(async t => {
      const r = await q<{c: number}>(`SELECT count(*)::int AS c FROM ${t}`);
      return {table: t, count: r[0]?.c ?? 0};
    })
  );
  const recent = canManageUsers(admin.role) ? await q(`SELECT actor, action, created_at FROM portal_audit ORDER BY id DESC LIMIT 15`) : [];
  return NextResponse.json({databaseConfigured: true, counts, recentAudit: recent});
}
