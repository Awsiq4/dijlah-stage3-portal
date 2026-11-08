import {drainSupport} from "@/lib/server/support";
import {NextRequest, NextResponse} from "next/server";
import {WORKER_SECRET, timingSafeEqual, telegramServiceEnabled} from "@/lib/server/flags";
import {drainQueue} from "@/lib/server/notify";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!WORKER_SECRET || !timingSafeEqual(req.headers.get("x-worker-secret") || "", WORKER_SECRET)) {
    return NextResponse.json({error: "forbidden"}, {status: 403});
  }
  if (!telegramServiceEnabled()) return NextResponse.json({enabled: false}, {status: 503});
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit")) || 100, 500);
  const result = await drainQueue(limit);
  const support = await drainSupport(20);
  return NextResponse.json({ok: true, ...result, support});
}
