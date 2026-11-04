import {NextRequest, NextResponse} from "next/server";
import {revokeSession, requireAdmin, SESSION_COOKIE} from "@/lib/server/auth";
import {audit} from "@/lib/server/content";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await revokeSession(token).catch(() => undefined);
    await audit(admin?.email || "session", "admin.logout", {});
  }
  const res = NextResponse.json({ok: true});
  res.cookies.set(SESSION_COOKIE, "", {httpOnly: true, path: "/", maxAge: 0});
  return res;
}
