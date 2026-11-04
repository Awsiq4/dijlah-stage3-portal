import {NextRequest, NextResponse} from "next/server";
import {ADMIN_SECRET, timingSafeEqual, telegramServiceEnabled, botConfigured, dbConfigured} from "@/lib/server/flags";
import {q} from "@/lib/server/db";
import {getMe} from "@/lib/server/telegram";
import {publishAndDeliver} from "@/lib/server/notify";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  if (!ADMIN_SECRET) return false;
  return timingSafeEqual(req.headers.get("x-admin-secret") || "", ADMIN_SECRET);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({error: "forbidden"}, {status: 403});
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
  });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({error: "forbidden"}, {status: 403});
  if (!telegramServiceEnabled()) return NextResponse.json({error: "service disabled (flag/db/bot missing)"}, {status: 503});
  const body = await req.json().catch(() => ({}));
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
