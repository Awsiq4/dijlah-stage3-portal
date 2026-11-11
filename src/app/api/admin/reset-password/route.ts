import {TELEGRAM_STAFF_ROLES} from "@/lib/telegram-roles";
import {createHash} from "node:crypto";
import {NextRequest, NextResponse} from "next/server";
import {checkLoginRateLimit, csrfWriteOk, hashPassword} from "@/lib/server/auth";
import {withTx} from "@/lib/server/db";
import {dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

// Recovery links are delivered to the verified account on Telegram.
export async function POST(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({error: "خدمة الاستعادة غير متاحة"}, {status: 503});
  if (req.headers.has("origin") && !csrfWriteOk(req)) return NextResponse.json({error: "forbidden"}, {status: 403});
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkLoginRateLimit("password-reset:" + ip, 5, 15 * 60_000))) {
    return NextResponse.json({error: "محاولات كثيرة. حاول لاحقًا."}, {status: 429});
  }

  const data = await req.json().catch(() => ({}));
  const token = String(data?.token ?? "");
  const password = String(data?.password ?? "");
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return NextResponse.json({error: "رابط الاستعادة غير صالح أو منتهي"}, {status: 401});
  }
  if (password.length < 12 || password.length > 128) {
    return NextResponse.json({error: "كلمة المرور يجب أن تكون بين 12 و128 حرفًا"}, {status: 400});
  }

  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  try {
    const applied = await withTx(async db => {
      // Lock the account before consuming a reset, in the same order as issuance and suspension.
      const account = await db.qOne<{id: number}>(
        `SELECT a.id FROM portal_admins a JOIN portal_password_resets r ON r.admin_id=a.id
         WHERE r.token_hash=$1 AND r.used_at IS NULL AND r.expires_at>now()
         AND (a.role='super_admin' OR a.role=ANY($2::text[])) AND a.is_active=true AND a.status='active' FOR UPDATE OF a`, [tokenHash, TELEGRAM_STAFF_ROLES]
      );
      if (!account) return false;
      const used = await db.qOne(
        `UPDATE portal_password_resets SET used_at=now() WHERE token_hash=$1
         AND used_at IS NULL AND expires_at>now() RETURNING token_hash`, [tokenHash]
      );
      if (!used) return false;
      await db.q(`UPDATE portal_admins SET password_hash=$2 WHERE id=$1`, [account.id, hashPassword(password)]);
      await db.q(`UPDATE portal_password_resets SET used_at=now() WHERE admin_id=$1 AND used_at IS NULL`, [account.id]);
      await db.q(`UPDATE portal_sessions SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL`, [account.id]);
      await db.q(`UPDATE portal_link_tokens SET used_at=now() WHERE admin_id=$1 AND used_at IS NULL`, [account.id]);
      await db.q(
        "INSERT INTO portal_audit (actor, action, detail) VALUES ($1,'admin.password_reset',$2::jsonb)",
        ["admin:" + account.id, JSON.stringify({method: "verified-telegram", revoked_sessions: true})]
      );
      return true;
    });
    if (!applied) return NextResponse.json({error: "رابط الاستعادة غير صالح أو منتهي أو مستخدم"}, {status: 401});
    return NextResponse.json({ok: true});
  } catch {
    return NextResponse.json({error: "تعذر تغيير كلمة المرور حاليًا"}, {status: 500});
  }
}
