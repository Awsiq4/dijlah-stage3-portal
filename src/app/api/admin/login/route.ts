import {NextRequest, NextResponse} from "next/server";
import {qOne, withTx} from "@/lib/server/db";
import {checkLoginRateLimit, csrfWriteOk, sha256Hex, verifyPassword, createSession, SESSION_COOKIE, SESSION_TTL_SECONDS} from "@/lib/server/auth";
import {auditBestEffort} from "@/lib/server/content";
import {verifyOwnerLogin} from "@/lib/server/owner-mfa";
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
    if (!valid) {
      await auditBestEffort(`unknown:${email}`, "admin.login.failed", {ip});
      return NextResponse.json({error: "Invalid credentials"}, {status: 401});
    }

    const result = await withTx(async db => {
      const current = await db.qOne<{role: string}>(
        `SELECT role FROM portal_admins WHERE id=$1 AND password_hash=$2
         AND is_active AND status='active' FOR UPDATE`, [admin.id, admin.password_hash]
      );
      if (!current) return {kind: "invalid_factor"} as const;
      const owner = current.role === "super_admin";
      const verification = owner ? await verifyOwnerLogin(db, admin.id, {
        code: typeof body?.code === "string" ? body.code.slice(0, 64) : "",
        enrollmentToken: typeof body?.enrollmentToken === "string" ? body.enrollmentToken.slice(0, 64).trim() : "",
        existingCode: typeof body?.existingCode === "string" ? body.existingCode.slice(0, 64) : "",
      }) : {kind: "verified", recoveryCodes: undefined} as const;
      if (verification.kind !== "verified") return verification;
      await db.q(`UPDATE portal_admins SET last_login_at=now() WHERE id=$1`, [admin.id]);
      return {...verification, token: await createSession(admin.id, db, owner), role: current.role} as const;
    });
    if (result.kind !== "verified") {
      if (result.kind === "invalid_factor") {
        await auditBestEffort(email, "admin.login.factor_failed", {ip});
        return NextResponse.json({step: result.kind}, {status: 401});
      }
      const setupKey = result.kind === "configure_authenticator" ? result.setupKey : undefined;
      return NextResponse.json({step: result.kind, setupKey}, {status: 202});
    }
    await auditBestEffort(email, "admin.login.success", {ip, ownerMfa: result.role === "super_admin"});
    const res = NextResponse.json({ok: true, email: admin.email, role: result.role, recoveryCodes: result.recoveryCodes});
    res.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    return res;
  } catch {
    console.error("admin login failed");
    return NextResponse.json({error: "Server error"}, {status: 500});
  }
}
