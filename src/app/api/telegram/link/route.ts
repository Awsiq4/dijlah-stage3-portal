import {NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";
import {canUseTelegramPublishing, newLinkToken, hashToken, linkStartParam} from "@/lib/server/rbac";
import {q, qOne} from "@/lib/server/db";
import {audit} from "@/lib/server/content";
import {dbConfigured, BOT_USERNAME} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

const LINK_TTL_SECONDS = 10 * 60;

// POST: create a short, single-use, expiring link token (stored hashed only).
// The deep link stays well under Telegram's 64-char /start limit.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!canUseTelegramPublishing(admin)) return NextResponse.json({error: "forbidden: role cannot use Telegram publishing"}, {status: 403});
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  if (!BOT_USERNAME) return NextResponse.json({error: "bot is not configured"}, {status: 503});

  const token = newLinkToken(); // 16 base64url chars
  const expires = new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString();
  await q(`INSERT INTO portal_link_tokens (token_hash, admin_id, expires_at) VALUES ($1,$2,$3)`, [hashToken(token), admin.id, expires]);
  await audit(admin.email || `admin#${admin.id}`, "telegram.link_token.created", {});
  const start = linkStartParam(token);
  return NextResponse.json({ok: true, deepLink: `https://t.me/${BOT_USERNAME}?start=${start}`, startParamLength: start.length});
}

// DELETE: unlink the caller's own Telegram account.
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  await q(`UPDATE portal_telegram_links SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL`, [admin.id]);
  await audit(admin.email || `admin#${admin.id}`, "telegram.link.revoked_self", {});
  return NextResponse.json({ok: true});
}

// GET: current link status for the caller
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!dbConfigured()) return NextResponse.json({linked: false, fromDatabase: false});
  const row = await qOne<{telegram_user_id: number}>(`SELECT telegram_user_id FROM portal_telegram_links WHERE admin_id=$1 AND revoked_at IS NULL`, [admin.id]);
  return NextResponse.json({linked: Boolean(row), telegram_user_id: row?.telegram_user_id ?? null});
}
