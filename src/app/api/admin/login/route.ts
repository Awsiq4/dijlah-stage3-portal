import {NextRequest, NextResponse} from "next/server";
import {qOne, withTx} from "@/lib/server/db";
import {checkLoginRateLimit, csrfWriteOk, sha256Hex, verifyPassword, createSession, SESSION_COOKIE, SESSION_TTL_SECONDS} from "@/lib/server/auth";
import {auditBestEffort} from "@/lib/server/content";
import {dbConfigured} from "@/lib/server/flags";

// Run the same KDF for unknown accounts to avoid a timing-based account lookup.
const DUMMY_PASSWORD_HASH = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!dbConfigured()) {
      return NextResponse.json({error: "DATABASE_URL is not configured — admin auth is disabled"}, {status: 503});
    }
    if (req.headers.has("origin") && !csrfWriteOk(req)) return NextResponse.json({error: "forbidden"}, {status: 403});
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!(await checkLoginRateLimit(`login:${ip}`))) {
      return NextResponse.json({error: "Too many attempts. Try again later."}, {status: 429});
    }
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!email || email.length > 254 || !password || password.length > 1024) return NextResponse.json({error: "Email and password are required"}, {status: 400});

    if (!await checkLoginRateLimit(`login:account:${sha256Hex(email)}`, 20, 15 * 60_000)) {
      return NextResponse.json({error: "Too many attempts. Try again later."}, {status: 429});
    }

    const admin = await qOne<{id: number; email: string; role: string; is_active: boolean; status: string; password_hash: string}>(
      `SELECT id, email, role, is_active, status, password_hash FROM portal_admins WHERE email=$1`, [email]
    );
    const passwordValid = verifyPassword(password, admin?.password_hash || DUMMY_PASSWORD_HASH);
    const valid = admin && admin.is_active && admin.status === "active" && passwordValid;
    // Login-attempt logging is best-effort by documented policy: it must never block a login or leak error details.
    await auditBestEffort(valid ? email : `unknown:${email}`, valid ? "admin.login.success" : "admin.login.failed", {ip});
    if (!valid) return NextResponse.json({error: "Invalid credentials"}, {status: 401});

    const token = await withTx(async db => {
      const current = await db.qOne(
        `UPDATE portal_admins SET last_login_at=now() WHERE id=$1 AND password_hash=$2
         AND is_active=true AND status='active' RETURNING id`, [admin.id, admin.password_hash]
      );
      return current ? createSession(admin.id, db) : null;
    });
    if (!token) return NextResponse.json({error: "Invalid credentials"}, {status: 401});
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
