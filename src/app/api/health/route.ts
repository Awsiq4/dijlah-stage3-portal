import {NextResponse} from "next/server";
import {telegramServiceEnabled, botConfigured, dbConfigured} from "@/lib/server/flags";
import {qOne} from "@/lib/server/db";

export const dynamic = "force-dynamic";

// Read-only schema probe: reports whether the Phase-2 RBAC migration is applied
// (never returns data, only booleans). Safe to call publicly.
async function migrationApplied(): Promise<boolean> {
  if (!dbConfigured()) return false;
  try {
    const col = await qOne<{exists: boolean}>(
      `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='portal_lectures' AND column_name='sections') AS exists`
    );
    const inv = await qOne<{exists: boolean}>(
      `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='portal_invitations') AS exists`
    );
    const links = await qOne<{exists: boolean}>(
      `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='portal_telegram_links') AS exists`
    );
    return Boolean(col?.exists && inv?.exists && links?.exists);
  } catch {
    return false;
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "dijlah-stage3-transfer",
    mode: "frontend-prototype+secure-admin-foundation",
    databaseConnected: dbConfigured(),
    migrationApplied: await migrationApplied(),
    telegramBotConfigured: botConfigured(),
    telegramServiceEnabled: telegramServiceEnabled(),
    adminAuthConfigured: Boolean(process.env.SESSION_SECRET || process.env.ADMIN_API_SECRET) && dbConfigured(),
    ragConnected: false,
  });
}
