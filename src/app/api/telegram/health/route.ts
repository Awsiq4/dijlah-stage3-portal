import {NextResponse} from "next/server";
import {telegramServiceEnabled, botConfigured, dbConfigured, TELEGRAM_BOT_ENABLED, BOT_USERNAME} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    service: "telegram-notifications",
    flag: TELEGRAM_BOT_ENABLED,
    enabled: telegramServiceEnabled(),
    botConfigured: botConfigured(),
    botUsername: botConfigured() ? BOT_USERNAME : null,
    databaseConfigured: dbConfigured(),
  }, {headers: {"cache-control": "no-store"}});
}
