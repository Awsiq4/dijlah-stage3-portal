import {NextRequest, NextResponse} from "next/server";
import {qOne} from "@/lib/server/db";
import {checkLoginRateLimit, hashPassword, verifyPassword, createSession, SESSION_COOKIE, SESSION_TTL_SECONDS} from "@/lib/server/auth";
import {audit} from "@/lib/server/content";
import {dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!dbConfigured()) {
      return NextResponse.json({error: "DATABASE_URL is not configured — admin auth is disabled"}, {status: 503});
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!checkLoginRateLimit(`login:${ip}`)) {
      return NextResponse.json({error: "Too many attempts. Try again later."}, {status: 429});
    }
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!email || !password) return NextResponse.json({error: "Email and password are required"}, {status: 400});

    const admin = await qOne<{id: number; email: string; role: string; is_active: boolean; password_hash: string}>(
      `SELECT id, email, role, is_active, password_hash FROM portal_admins WHERE email=$1`, [email]
    );
    const valid = admin && admin.is_active && verifyPassword(password, admin.password_hash);
    await audit(valid ? email : `unknown:${email}`, valid ? "admin.login.success" : "admin.login.failed", {ip});
    if (!valid) return NextResponse.json({error: "Invalid credentials"}, {status: 401});

    await qOne(`UPDATE portal_admins SET last_login_at=now() WHERE id=$1`, [admin.id]);
    const token = await createSession(admin.id);
    const res = NextResponse.json({ok: true, email: admin.email, role: admin.role});
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    console.error("admin login error", err instanceof Error ? err.message : err);
    return NextResponse.json({error: "Server error"}, {status: 500});
  }
}
