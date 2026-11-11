import {NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";
import {canManageUsers, newToken, hashToken, ROLES, SECTIONS} from "@/lib/server/rbac";
import {withTx, q} from "@/lib/server/db";
import {audit} from "@/lib/server/content";
import {dbConfigured, PORTAL_BASE_URL} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

async function requireUserAdmin(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (!admin) return {admin: null, res: NextResponse.json({error: "unauthorized"}, {status: 401})};
  if (!canManageUsers(admin.role)) return {admin: null, res: NextResponse.json({error: "forbidden: super_admin only"}, {status: 403})};
  return {admin, res: null as NextResponse | null};
}

// GET: account directory (never returns password hashes)
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!dbConfigured()) return NextResponse.json({users: [], fromDatabase: false});
  if (!canManageUsers(admin.role)) return NextResponse.json({error: "forbidden: super_admin only"}, {status: 403});
  const users = await q(
    `SELECT a.id, a.email, a.name, a.role, a.status, a.is_active, a.assigned_section, a.assigned_subjects, a.perms,
            a.last_login_at, a.created_at, a.telegram_expected_id, a.telegram_expected_username,
            (SELECT l.telegram_user_id FROM portal_telegram_links l WHERE l.admin_id=a.id AND l.revoked_at IS NULL LIMIT 1) AS telegram_user_id
     FROM portal_admins a ORDER BY a.id`
  );
  const invitations = await q(`SELECT id, email, name, role, assigned_section, expires_at, used_at, created_at, telegram_expected_id, telegram_expected_username FROM portal_invitations ORDER BY id DESC LIMIT 50`);
  return NextResponse.json({fromDatabase: true, users, invitations});
}

// POST: create invitation (one-time token, 7 days). The setup link is returned ONCE here.
export async function POST(req: NextRequest) {
  const {admin, res} = await requireUserAdmin(req);
  if (!admin) return res!;
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  const body = await req.json().catch(() => null);
  const email = String(body?.email || "").trim().toLowerCase();
  const role = String(body?.role || "");
  const name = String(body?.name || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({error: "invalid email"}, {status: 400});
  if (!(ROLES as readonly string[]).includes(role)) return NextResponse.json({error: "invalid role"}, {status: 400});
  const section = body?.assigned_section ? String(body.assigned_section) : null;
  if (section && !(SECTIONS as readonly string[]).includes(section)) return NextResponse.json({error: "invalid section"}, {status: 400});
  const subjects = Array.isArray(body?.assigned_subjects) ? body.assigned_subjects.map(String) : [];
  const perms = body?.perms && typeof body.perms === "object" ? body.perms : {};
  if (!name) return NextResponse.json({error: "name required"}, {status: 400});

  const telegramId = String(body?.telegram_user_id ?? "").trim();
  const telegramUsername = String(body?.telegram_username ?? "").trim().replace(/^@/, "");
  if ((telegramId || telegramUsername) && (
    role !== "teacher" || !/^[1-9][0-9]{0,15}$/.test(telegramId) ||
    !Number.isSafeInteger(Number(telegramId)) ||
    (telegramUsername && !/^[A-Za-z0-9_]{1,32}$/.test(telegramUsername))
  )) return NextResponse.json({error: "أدخل رقم Telegram ID صالحًا للتدريسي. اسم المستخدم اختياري."}, {status: 400});

  const token = newToken();
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const issued = await withTx(async db => {
    if (telegramId && await db.qOne(
      `SELECT 1 FROM portal_admins WHERE telegram_expected_id=$1
       UNION ALL SELECT 1 FROM portal_telegram_links WHERE telegram_user_id=$1 AND revoked_at IS NULL
       UNION ALL SELECT 1 FROM portal_invitations WHERE telegram_expected_id=$1 AND email<>$2
         AND used_at IS NULL AND expires_at>now() LIMIT 1`,
      [telegramId, email]
    )) return false;
    await db.q(
      `INSERT INTO portal_invitations (email, name, role, assigned_section, assigned_subjects, perms, token_hash, expires_at, created_by, telegram_expected_id, telegram_expected_username)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [email, name, role, section, JSON.stringify(subjects), JSON.stringify(perms), hashToken(token), expires, admin.id, telegramId || null, telegramUsername || null]
    );
    await audit(admin.email, "users.invite", {email, role, section, subjects, telegram_preassigned: Boolean(telegramId)}, db);
    return true;
  });
  if (!issued) return NextResponse.json({error: "رقم Telegram ID مسجّل لحساب آخر أو لدعوة فعّالة."}, {status: 409});
  return NextResponse.json({ok: true, email, role, setupUrl: `${PORTAL_BASE_URL}/admin/setup?token=${encodeURIComponent(token)}`});
}

// PATCH: edit account (role/assignments/status). Suspending revokes sessions + telegram links immediately.
export async function PATCH(req: NextRequest) {
  const {admin, res} = await requireUserAdmin(req);
  if (!admin) return res!;
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return NextResponse.json({error: "id required"}, {status: 400});
  const fields: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  const push = (col: string, val: unknown) => { fields.push(`${col}=$${i++}`); params.push(val); };
  if (body.role !== undefined) {
    if (!(ROLES as readonly string[]).includes(String(body.role))) return NextResponse.json({error: "invalid role"}, {status: 400});
    push("role", String(body.role));
  }
  if (body.name !== undefined) push("name", String(body.name));
  if (body.assigned_section !== undefined) push("assigned_section", body.assigned_section ? String(body.assigned_section) : null);
  if (body.assigned_subjects !== undefined) push("assigned_subjects", JSON.stringify(body.assigned_subjects));
  if (body.perms !== undefined) push("perms", JSON.stringify(body.perms));
  if (body.status !== undefined) {
    if (!["active", "suspended"].includes(String(body.status))) return NextResponse.json({error: "invalid status"}, {status: 400});
    push("status", String(body.status));
    push("is_active", String(body.status) === "active");
  }
  if (!fields.length) return NextResponse.json({error: "nothing to update"}, {status: 400});
  params.push(id);
  await withTx(async db => {
    await db.q(`UPDATE portal_admins SET ${fields.join(", ")} WHERE id=$${i}`, params);
    if (String(body.status) === "suspended") {
      await db.q(`UPDATE portal_sessions SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL`, [id]);
      await db.q(`UPDATE portal_link_tokens SET used_at=now() WHERE admin_id=$1 AND used_at IS NULL`, [id]);
      await db.q(`UPDATE portal_password_resets SET used_at=now() WHERE admin_id=$1 AND used_at IS NULL`, [id]);
      await db.q(`UPDATE portal_telegram_links SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL`, [id]);
    }
    await audit(admin.email, "users.update", {id, fields: Object.keys(body)}, db);
  });
  return NextResponse.json({ok: true});
}
