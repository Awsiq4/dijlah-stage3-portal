import {NextRequest, NextResponse} from "next/server";
import {hashToken, tokenMatches, tokenUsable} from "@/lib/server/rbac";
import {hashPassword, createSession, SESSION_COOKIE, SESSION_TTL_SECONDS, checkLoginRateLimit} from "@/lib/server/auth";
import {withTx, qOne} from "@/lib/server/db";
import {auditBestEffort} from "@/lib/server/content";
import {dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

// Public endpoint: completes a one-time invitation by setting the password.
// The token is single-use, hashed at rest, and expires.
export async function POST(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkLoginRateLimit(`setup:${ip}`))) return NextResponse.json({error: "Too many attempts. Try again later."}, {status: 429});
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token || "");
  const password = String(body?.password || "");
  if (!token) return NextResponse.json({error: "token required"}, {status: 400});
  if (password.length < 12) return NextResponse.json({error: "Password must be at least 12 characters"}, {status: 400});

  const inv = await qOne<{
    id: number; email: string; name: string; role: string; assigned_section: string | null;
    assigned_subjects: string[]; perms: Record<string, unknown>; token_hash: string; expires_at: string; used_at: string | null;
  }>(`SELECT * FROM portal_invitations WHERE token_hash=$1`, [hashToken(token)]);

  if (!inv || !tokenMatches(token, inv.token_hash)) {
    await auditBestEffort("setup", "invite.invalid_token", {ip});
    return NextResponse.json({error: "Invalid invitation link"}, {status: 401});
  }
  if (!tokenUsable(inv)) {
    await auditBestEffort("setup", "invite.expired_or_used", {ip, email: inv.email});
    return NextResponse.json({error: "Invitation expired or already used"}, {status: 410});
  }

  const existing = await qOne<{id: number; status: string}>(`SELECT id, status FROM portal_admins WHERE email=$1`, [inv.email]);
  if (existing && existing.status === "active") return NextResponse.json({error: "Account already active — sign in instead"}, {status: 409});

  const adminId = await withTx(async db => {
    const row = await db.qOne<{id: number}>(
      `INSERT INTO portal_admins (email, name, password_hash, role, status, is_active, assigned_section, assigned_subjects, perms)
       VALUES ($1,$2,$3,$4,'active',true,$5,$6,$7)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role=EXCLUDED.role,
         status='active', is_active=true, assigned_section=EXCLUDED.assigned_section,
         assigned_subjects=EXCLUDED.assigned_subjects, perms=EXCLUDED.perms
       RETURNING id`,
      [inv.email, inv.name, hashPassword(password), inv.role, inv.assigned_section, JSON.stringify(inv.assigned_subjects || []), JSON.stringify(inv.perms || {})]
    );
    await db.q(`UPDATE portal_invitations SET used_at=now() WHERE id=$1`, [inv.id]);
    await db.q(`INSERT INTO portal_audit (actor, action, detail) VALUES ($1,$2,$3)`, [inv.email, "users.activated", {role: inv.role}]);
    return row!.id;
  });

  const sessionToken = await createSession(adminId);
  const res = NextResponse.json({ok: true, email: inv.email, role: inv.role});
  res.cookies.set(SESSION_COOKIE, sessionToken, {httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: SESSION_TTL_SECONDS});
  return res;
}
