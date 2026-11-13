import {NextResponse} from "next/server";
import {telegramServiceEnabled, botConfigured, dbConfigured} from "@/lib/server/flags";
import {qOne} from "@/lib/server/db";

export const dynamic = "force-dynamic";

// One read checks both the live connection and the Phase-2 schema.
async function probeDatabase(): Promise<{connected: boolean; migration: boolean}> {
  try {
    const result = await qOne<{migration: boolean}>(`SELECT
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='portal_lectures' AND column_name='sections')
      AND to_regclass('public.portal_invitations') IS NOT NULL
      AND to_regclass('public.portal_telegram_links') IS NOT NULL AS migration`);
    return {connected: result !== null, migration: result?.migration === true};
  } catch {
    return {connected: false, migration: false};
  }
}

export async function GET() {
  const configured = dbConfigured();
  const {connected, migration} = configured ? await probeDatabase() : {connected: false, migration: false};
  const degraded = configured && (!connected || !migration);
  return NextResponse.json({
    status: degraded ? "degraded" : "ok",
    service: "dijlah-stage3-transfer",
    mode: "frontend-prototype+secure-admin-foundation",
    databaseConfigured: configured,
    databaseConnected: connected,
    migrationApplied: migration,
    telegramBotConfigured: botConfigured(),
    telegramServiceEnabled: telegramServiceEnabled(),
    adminAuthConfigured: Boolean(process.env.SESSION_SECRET) && dbConfigured(),
    ragConnected: false,
  }, {status: degraded ? 503 : 200, headers: {"Cache-Control": "no-store"}});
}
