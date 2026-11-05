import {NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";

export const dynamic = "force-dynamic";

// Returns only a safe whitelist of the authenticated admin's fields —
// never password_hash, sessions, or any other column.
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({authenticated: false}, {status: 401});
  return NextResponse.json({
    authenticated: true,
    id: admin.id,
    email: admin.email,
    name: admin.name || "",
    role: admin.role,
    status: admin.status || "active",
    assigned_section: admin.assigned_section ?? null,
    assigned_subjects: admin.assigned_subjects ?? [],
    perms: admin.perms ?? {},
  });
}
