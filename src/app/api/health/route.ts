import {NextResponse} from "next/server";
import {telegramServiceEnabled, botConfigured, dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "dijlah-stage3-transfer",
    mode: "frontend-prototype+secure-admin-foundation",
    databaseConnected: dbConfigured(),
    telegramBotConfigured: botConfigured(),
    telegramServiceEnabled: telegramServiceEnabled(),
    adminAuthConfigured: Boolean(process.env.SESSION_SECRET || process.env.ADMIN_API_SECRET) && dbConfigured(),
    ragConnected: false,
  });
}
