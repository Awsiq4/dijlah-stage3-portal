import {NextRequest, NextResponse} from "next/server";
import {revokeSession, SESSION_COOKIE} from "@/lib/server/auth";
import {audit} from "@/lib/server/content";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await revokeSession(token).catch(() => undefined);
    await audit("session", "admin.logout", {});
  }
  const res = NextResponse.json({ok: true});
  res.cookies.set(SESSION_COOKIE, "", {httpOnly: true, path: "/", maxAge: 0});
  return res;
}
