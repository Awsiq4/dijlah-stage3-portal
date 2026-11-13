import {NextRequest, NextResponse} from "next/server";
import {WORKER_SECRET, timingSafeEqual, telegramServiceEnabled} from "@/lib/server/flags";
import {drainQueue} from "@/lib/server/notify";
import {drainSupportQueue} from "@/lib/server/botsupport";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!WORKER_SECRET || !timingSafeEqual(req.headers.get("x-worker-secret") || "", WORKER_SECRET)) {
    return NextResponse.json({error: "forbidden"}, {status: 403});
  }
  if (!telegramServiceEnabled()) return NextResponse.json({enabled: false}, {status: 503});
  const rawLimit = new URL(req.url).searchParams.get("limit");
  const requested = rawLimit === null ? 100 : Number(rawLimit);
  if (!Number.isInteger(requested) || requested < 1) return NextResponse.json({error: "invalid limit"}, {status: 400});
  const limit = Math.min(requested, 500);
  const result = await drainQueue(limit);
  const support = await drainSupportQueue(Math.min(limit,30));
  return NextResponse.json({ok: true, ...result, support});
}
