import {NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";
import {canUseTelegramPublishing, newToken, hashToken, signLinkPayload} from "@/lib/server/rbac";
import {q, qOne} from "@/lib/server/db";
import {audit} from "@/lib/server/content";
import {dbConfigured, BOT_USERNAME, SUBSCRIPTION_SECRET} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

const LINK_TTL_SECONDS = 10 * 60;

// POST: create a one-time, expiring deep-link token to bind this admin's Telegram account.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!canUseTelegramPublishing(admin)) return NextResponse.json({error: "forbidden: role cannot use Telegram publishing"}, {status: 403});
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  if (!BOT_USERNAME) return NextResponse.json({error: "bot is not configured"}, {status: 503});

  const token = newToken();
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString();
  await q(`INSERT INTO portal_link_tokens (token_hash, admin_id, expires_at) VALUES ($1,$2,$3)`, [tokenHash, admin.id, expires]);
  await audit(admin.email, "telegram.link_token.created", {});
  const secret = SUBSCRIPTION_SECRET || process.env.SESSION_SECRET || process.env.ADMIN_API_SECRET || "";
  const payload = signLinkPayload(admin.id, tokenHash, secret, LINK_TTL_SECONDS);
  return NextResponse.json({ok: true, deepLink: `https://t.me/${BOT_USERNAME}?start=link_${payload}`});
}

// DELETE: unlink the caller's own Telegram account.
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!dbConfigured()) return NextResponse.json({error: "DATABASE_URL is not configured"}, {status: 503});
  await q(`UPDATE portal_telegram_links SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL`, [admin.id]);
  await audit(admin.email, "telegram.link.revoked_self", {});
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
