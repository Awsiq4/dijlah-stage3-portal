import {createHash} from "node:crypto";
import {NextRequest, NextResponse} from "next/server";
import {checkLoginRateLimit, hashPassword} from "@/lib/server/auth";
import {withTx} from "@/lib/server/db";
import {dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

// Tokens are generated out-of-band only after confirming control of the
// existing admin email account. There is no public token issuance endpoint.
export async function POST(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({error: "خدمة الاستعادة غير متاحة"}, {status: 503});
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
      // Lock the reset row so parallel uses cannot both succeed.
      const reset = await db.qOne<{admin_id: number}>(
        "SELECT r.admin_id FROM portal_password_resets r " +
        "JOIN portal_admins a ON a.id=r.admin_id " +
        "WHERE r.token_hash=$1 AND r.used_at IS NULL AND r.expires_at>now() " +
        "AND a.is_active=true AND a.status='active' FOR UPDATE OF r",
        [tokenHash]
      );
      if (!reset) return false;
      await db.q("UPDATE portal_admins SET password_hash=$2 WHERE id=$1",
        [reset.admin_id, hashPassword(password)]);
      await db.q("UPDATE portal_password_resets SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL",
        [tokenHash]);
      await db.q("UPDATE portal_sessions SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL",
        [reset.admin_id]);
      await db.q(
        "INSERT INTO portal_audit (actor, action, detail) VALUES ($1,'admin.password_reset',$2::jsonb)",
        ["admin:" + reset.admin_id, JSON.stringify({method: "verified-email", revoked_sessions: true})]
      );
      return true;
    });
    if (!applied) return NextResponse.json({error: "رابط الاستعادة غير صالح أو منتهي أو مستخدم"}, {status: 401});
    return NextResponse.json({ok: true});
  } catch {
    return NextResponse.json({error: "تعذر تغيير كلمة المرور حاليًا"}, {status: 500});
  }
}
