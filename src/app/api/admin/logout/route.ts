import {NextRequest, NextResponse} from "next/server";
import {csrfWriteOk, revokeSession, requireAdmin, SESSION_COOKIE} from "@/lib/server/auth";
import {auditBestEffort} from "@/lib/server/content";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Reject the request before touching the session even when authentication fails.
  if (!csrfWriteOk(req)) return NextResponse.json({error: "forbidden"}, {status: 403});
  const admin = await requireAdmin(req, {write: true});
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await revokeSession(token);
    } catch {
      // A cleared browser cookie must not imply successful server revocation.
      return NextResponse.json({error: "تعذر إنهاء الجلسة. حاول مجددًا."}, {status: 503});
    }
    await auditBestEffort(admin?.email || "session", "admin.logout", {});
  }
  const res = NextResponse.json({ok: true});
  res.cookies.set(SESSION_COOKIE, "", {httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0});
  return res;
}
