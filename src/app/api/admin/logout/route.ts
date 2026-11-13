import {NextRequest, NextResponse} from "next/server";
import {csrfWriteOk, revokeSession, requireAdmin, SESSION_COOKIE} from "@/lib/server/auth";
import {audit} from "@/lib/server/content";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!csrfWriteOk(req)) return NextResponse.json({error: "forbidden"}, {status: 403});
  const admin = await requireAdmin(req);
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await revokeSession(token).catch(() => undefined);
    await audit(admin?.email || "session", "admin.logout", {});
  }
  const res = NextResponse.json({ok: true});
  res.cookies.set(SESSION_COOKIE, "", {httpOnly: true, path: "/", maxAge: 0});
  return res;
}
