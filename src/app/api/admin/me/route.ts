import {NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({authenticated: false}, {status: 401});
  return NextResponse.json({authenticated: true, email: admin.email, role: admin.role});
}
