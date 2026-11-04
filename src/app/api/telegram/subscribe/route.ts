import {NextRequest, NextResponse} from "next/server";
import {BOT_USERNAME, SUBSCRIPTION_SECRET, telegramServiceEnabled} from "@/lib/server/flags";
import {signSubscribeToken} from "@/lib/server/tokens";

export const dynamic = "force-dynamic";

const SECTIONS = ["A", "B", "C", "F"];
const TOKEN_TTL_SECONDS = 15 * 60;

export async function POST(req: NextRequest) {
  try {
    if (!telegramServiceEnabled()) {
      return NextResponse.json({enabled: false, reason: "service-disabled"}, {status: 503});
    }
    if (!SUBSCRIPTION_SECRET) {
      return NextResponse.json({enabled: false, reason: "subscription-secret-missing"}, {status: 503});
    }
    const body = await req.json().catch(() => ({}));
    const section = String(body?.section || "").toUpperCase();
    if (!SECTIONS.includes(section)) {
      return NextResponse.json({enabled: false, reason: "invalid-section"}, {status: 400});
    }
    const token = signSubscribeToken(section, SUBSCRIPTION_SECRET, TOKEN_TTL_SECONDS);
    const url = `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(token)}`;
    return NextResponse.json({enabled: true, url, section, expiresIn: TOKEN_TTL_SECONDS});
  } catch {
    return NextResponse.json({enabled: false, reason: "error"}, {status: 500});
  }
}
