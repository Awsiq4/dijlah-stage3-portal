import {NextRequest, NextResponse} from "next/server";
import {hashToken} from "@/lib/server/rbac";
import {hashPassword, createSession, SESSION_COOKIE, SESSION_TTL_SECONDS, checkLoginRateLimit, csrfWriteOk} from "@/lib/server/auth";
import {withTx} from "@/lib/server/db";
import {dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

// Public endpoint: completes a one-time invitation by setting the password.
// The token is single-use, hashed at rest, and expires.
export async function POST(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  if (req.headers.has("origin") && !csrfWriteOk(req)) return NextResponse.json({error: "forbidden"}, {status: 403});
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkLoginRateLimit(`setup:${ip}`))) return NextResponse.json({error: "Too many attempts. Try again later."}, {status: 429});
  const body = await req.json().catch(() => ({}));
  const token = String(body?.token || "");
  const password = String(body?.password || "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return NextResponse.json({error: "Invalid invitation link"}, {status: 401});
  if (password.length < 12 || password.length > 128) return NextResponse.json({error: "Password must be between 12 and 128 characters"}, {status: 400});

  const result = await withTx(async db => {
    // A conditional UPDATE locks and consumes the token in the same transaction.
    const inv = await db.qOne<{
      email: string; name: string; role: string; assigned_section: string | null;
      assigned_subjects: string[]; perms: Record<string, unknown>;
    }>(`UPDATE portal_invitations SET used_at=now()
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()
       RETURNING email,name,role,assigned_section,assigned_subjects,perms`, [hashToken(token)]);
    if (!inv) return {status: 410} as const;
    const row = await db.qOne<{id: number}>(
      `INSERT INTO portal_admins (email, name, password_hash, role, status, is_active, assigned_section, assigned_subjects, perms)
       VALUES ($1,$2,$3,$4,'active',true,$5,$6,$7)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash, role=EXCLUDED.role,
         status='active', is_active=true, assigned_section=EXCLUDED.assigned_section,
         assigned_subjects=EXCLUDED.assigned_subjects, perms=EXCLUDED.perms
       WHERE portal_admins.status='invited'
       RETURNING id`,
      [inv.email, inv.name, hashPassword(password), inv.role, inv.assigned_section, JSON.stringify(inv.assigned_subjects || []), JSON.stringify(inv.perms || {})]
    );
    if (!row) return {status: 409} as const;
    await db.q(`INSERT INTO portal_audit (actor, action, detail) VALUES ($1,$2,$3)`, [inv.email, "users.activated", {role: inv.role}]);
    return {status: 200, email: inv.email, role: inv.role, session: await createSession(row.id, db)} as const;
  });

  if (result.status !== 200) {
    const error = result.status === 410 ? "Invitation invalid, expired or already used" : "Account already exists";
    return NextResponse.json({error}, {status: result.status});
  }
  const res = NextResponse.json({ok: true, email: result.email, role: result.role});
  res.cookies.set(SESSION_COOKIE, result.session, {httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: SESSION_TTL_SECONDS});
  return res;
}
