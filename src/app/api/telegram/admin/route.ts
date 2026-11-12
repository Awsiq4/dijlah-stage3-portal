import {NextRequest, NextResponse} from "next/server";
import {telegramServiceEnabled, botConfigured, dbConfigured, PORTAL_BASE_URL, WEBHOOK_SECRET} from "@/lib/server/flags";
import {q} from "@/lib/server/db";
import {getMe, setWebhook, tgFetch} from "@/lib/server/telegram";
import {expectedProductionWebhook,isOfficialProductionWebhook,isKnownProjectPreviewWebhook} from "@/lib/server/telegram-webhook-hosts";
import {requireAdmin} from "@/lib/server/auth";
import {publishAndDeliver} from "@/lib/server/notify";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const caller = await requireAdmin(req);
  if (caller?.role !== "super_admin") return NextResponse.json({error: "forbidden"}, {status: 403});
  const enabled = telegramServiceEnabled();
  const bot = botConfigured() ? await getMe() : null;
  let stats: unknown = null;
  if (dbConfigured()) {
    const [subs, bySection, events, deliveries, recent] = await Promise.all([
      q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status='active')::int AS active, count(*) FILTER (WHERE status='stopped')::int AS stopped FROM tg_subscribers`),
      q(`SELECT section, count(*)::int AS total, count(*) FILTER (WHERE status='active')::int AS active FROM tg_subscribers GROUP BY section ORDER BY section`),
      q(`SELECT count(*)::int AS events FROM tg_events`),
      q(`SELECT status, count(*)::int AS n FROM tg_deliveries GROUP BY status`),
      q(`SELECT id, event_key, type, title, scope, section, priority, created_at FROM tg_events ORDER BY id DESC LIMIT 20`),
    ]);
    stats = {subs: subs[0], bySection, events: events[0], deliveries, recentEvents: recent};
  }
  return NextResponse.json({
    enabled,
    botConfigured: botConfigured(),
    databaseConfigured: dbConfigured(),
    bot: bot?.ok ? {username: bot.result?.username, isBot: bot.result?.is_bot} : bot?.error || null,
    stats,
    webhook: botConfigured() ? await tgFetch<{url: string; pending_update_count: number; last_error_date?: number}>("getWebhookInfo", {}).then(r => r.ok ? {host: r.result?.url ? new URL(r.result.url).host : null, path: r.result?.url ? new URL(r.result.url).pathname : null, pending: r.result?.pending_update_count ?? 0, lastErrorAt: r.result?.last_error_date ?? null} : null) : null,
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (admin?.role !== "super_admin") return NextResponse.json({error: "forbidden"}, {status: 403});
  const body = await req.json().catch(() => ({}));
  if (body?.action === "configure-webhook") {
    if (!telegramServiceEnabled() || !WEBHOOK_SECRET) {
      return NextResponse.json({error: "bot configuration incomplete"}, {status: 503});
    }
    const target = expectedProductionWebhook(PORTAL_BASE_URL);
    if (!target) {
      return NextResponse.json({error: "Production webhook host is not a verified project alias"}, {status: 503});
    }
    const bot = await getMe();
    if (!bot.ok) return NextResponse.json({error: "Telegram bot authentication failed"}, {status: 502});
    const before = await tgFetch<{url: string}>("getWebhookInfo", {});
    if (!before.ok) return NextResponse.json({error: "Unable to inspect Telegram webhook"}, {status: 502});
    // The custom domain and the existing production .vercel.app alias are
    // both verified to serve this same Vercel project.
    if (before.result?.url && !isOfficialProductionWebhook(before.result.url)
      && !isKnownProjectPreviewWebhook(before.result.url))
      return NextResponse.json({error: "Bot is connected to an unknown deployment; manual verification required"}, {status: 409});
    const configured = await setWebhook(target, WEBHOOK_SECRET);
    if (!configured.ok) return NextResponse.json({error: "Telegram webhook registration failed"}, {status: 502});
    const info = await tgFetch<{url: string; pending_update_count: number; last_error_date?: number}>("getWebhookInfo", {});
    return NextResponse.json({
      ok: info.ok && info.result?.url === target,
      bot: bot.result?.username,
      webhookHost: new URL(target).host,
      pendingUpdates: info.result?.pending_update_count,
      lastErrorAt: info.result?.last_error_date || null,
    });
  }
  if (!telegramServiceEnabled()) return NextResponse.json({error: "service disabled (flag/db/bot missing)"}, {status: 503});
  if (body?.action !== "test") return NextResponse.json({error: "unknown action"}, {status: 400});
  const result = await publishAndDeliver({
    type: "test",
    refId: `test-${Date.now()}`,
    version: 1,
    title: "رسالة اختبار من مركز إشعارات تليجرام",
    body: `اختبار توصيل من لوحة الإدارة — ${new Date().toISOString()}`,
    url: "/",
    scope: "general",
  });
  return NextResponse.json({ok: true, result});
}
