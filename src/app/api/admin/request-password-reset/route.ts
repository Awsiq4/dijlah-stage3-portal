import {TELEGRAM_STAFF_ROLES} from "@/lib/telegram-roles";
import {createHash, randomBytes} from "node:crypto";
import {NextRequest, NextResponse} from "next/server";
import {checkLoginRateLimit, csrfWriteOk} from "@/lib/server/auth";
import {q, withTx} from "@/lib/server/db";
import {BOT_OWNER_ID, PORTAL_BASE_URL, telegramServiceEnabled} from "@/lib/server/flags";
import {sendMessage} from "@/lib/server/telegram";

export const dynamic = "force-dynamic";

// An unauthenticated caller can only request a reset message sent to the
// verified, already-linked account on Telegram. The token itself is never
// returned in an HTTP response and cannot be sent to an arbitrary chat.
export async function POST(req: NextRequest) {
  if (!telegramServiceEnabled()) {
    return NextResponse.json({error: "خدمة استعادة الحساب غير متاحة حاليًا"}, {status: 503});
  }
  if (req.headers.has("origin") && !csrfWriteOk(req)) return NextResponse.json({error: "forbidden"}, {status: 403});
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkLoginRateLimit("reset-link:" + ip, 3, 15 * 60_000))) {
    return NextResponse.json({error: "محاولات كثيرة. حاول بعد 15 دقيقة."}, {status: 429});
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    return NextResponse.json({error: "أدخل بريدًا إلكترونيًا صالحًا."}, {status: 400});
  }
  const ownerId = /^[0-9]+$/.test(BOT_OWNER_ID) ? BOT_OWNER_ID : null;

  try {
    const created = await withTx(async db => {
      const admin = await db.qOne<{id: number; telegram_user_id: string}>(
        `SELECT a.id,l.telegram_user_id FROM portal_admins a
         JOIN portal_telegram_links l ON l.admin_id=a.id AND l.revoked_at IS NULL
         WHERE a.status='active' AND a.is_active=true
           AND ((a.role='super_admin' AND l.telegram_user_id=$2 AND ($1='' OR a.email=$1))
             OR (a.role=ANY($3::text[]) AND a.email=$1
               AND (a.telegram_expected_id IS NULL OR a.telegram_expected_id=l.telegram_user_id)))
         LIMIT 1 FOR UPDATE OF a`,
        [email, ownerId, TELEGRAM_STAFF_ROLES]
      );
      if (!admin) return {issued: false} as const;
      const recent = await db.qOne(
        "SELECT token_hash FROM portal_password_resets " +
        "WHERE admin_id=$1 AND used_at IS NULL AND created_at > now() - interval '10 minutes' " +
        "ORDER BY created_at DESC LIMIT 1",
        [admin.id]
      );
      if (recent) return {issued: false} as const;
      const token = randomBytes(32).toString("hex");
      const digest = createHash("sha256").update(token, "utf8").digest("hex");
      await db.q(
        "INSERT INTO portal_password_resets (token_hash, admin_id, expires_at) " +
        "VALUES ($1, $2, now() + interval '30 minutes')",
        [digest, admin.id]
      );
      return {issued: true, token, digest, telegramUserId: admin.telegram_user_id} as const;
    });

    if (created.issued) {
      const link = new URL("/admin/reset-password", PORTAL_BASE_URL);
      link.searchParams.set("token", created.token);
      const result = await sendMessage(
        Number(created.telegramUserId),
        "🔐 طلب استعادة كلمة مرور لوحة إدارة بوابة المرحلة الثالثة.\n\n" +
        "افتح الرابط التالي لتعيين كلمة مرور جديدة:\n" + link.toString() +
        "\n\n⏱ صالح لمدة 30 دقيقة ولمرة واحدة فقط. لا تشارك الرابط مع أحد.\n" +
        "إذا لم تطلب الاستعادة، تجاهل هذه الرسالة.",
        {replyMarkup: {inline_keyboard: [[{text: "🔐 تعيين كلمة مرور جديدة", url: link.toString()}]]}}
      );
      if (!result.ok) {
        // Invalidate any unsent token rather than leaving a live recovery link.
        await q("UPDATE portal_password_resets SET used_at=now() WHERE token_hash=$1", [created.digest]);
      }
    }
    // No user, account, token, or Telegram recipient information is disclosed.
    return NextResponse.json({ok: true});
  } catch {
    return NextResponse.json({error: "تعذرت الاستعادة حالياً"}, {status: 503});
  }
}
