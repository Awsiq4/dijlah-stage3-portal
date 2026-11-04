import {NextRequest, NextResponse} from "next/server";
import {getPublicContent, PUBLIC_TYPES, type PublicType} from "@/lib/server/public";
import {validSection} from "@/lib/server/public-filters";
import {dbConfigured} from "@/lib/server/flags";

// Public, read-only, no-login endpoint. Exposes ONLY published/approved content.
// Never returns drafts, admin accounts, sessions, audit logs, or subscriber data.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const type = (sp.get("type") || "all") as PublicType;
  if (!PUBLIC_TYPES.includes(type)) return NextResponse.json({error: "invalid type"}, {status: 400});
  const section = validSection(sp.get("section") || "A");
  const {fromDatabase, content} = await getPublicContent(type, section);
  const res = NextResponse.json({fromDatabase, section, type, content});
  res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  return res;
}
