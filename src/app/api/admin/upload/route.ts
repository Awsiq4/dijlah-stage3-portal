import {NextRequest, NextResponse} from "next/server";
import {requireAdmin} from "@/lib/server/auth";
import {canUseTelegramPublishing} from "@/lib/server/rbac";
import {uploadLecturePdf, isPdf, MAX_PDF_BYTES} from "@/lib/server/storage";
import {audit} from "@/lib/server/content";
import {dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST multipart/form-data with field "file" (PDF). Used by the admin dashboard
// (mobile upload) — the same stored URL is then referenced by the lecture record.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (!canUseTelegramPublishing(admin)) return NextResponse.json({error: "forbidden: role cannot upload"}, {status: 403});
  let file: File | null = null;
  try {
    const form = await req.formData();
    file = form.get("file") as File | null;
  } catch { return NextResponse.json({error: "multipart form-data required"}, {status: 400}); }
  if (!file) return NextResponse.json({error: "file field required"}, {status: 400});
  if (file.size > MAX_PDF_BYTES) return NextResponse.json({error: "File exceeds the 20MB limit"}, {status: 413});
  const buf = Buffer.from(await file.arrayBuffer());
  if (!isPdf(buf)) return NextResponse.json({error: "File is not a valid PDF"}, {status: 400});
  try {
    const {url, name} = await uploadLecturePdf(buf, file.name);
    if (dbConfigured()) await audit(admin.email || `admin#${admin.id}`, "upload.pdf", {name, bytes: buf.length});
    return NextResponse.json({ok: true, url, name, bytes: buf.length});
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upload failed";
    return NextResponse.json({error: msg}, {status: msg.includes("not configured") ? 503 : 500});
  }
}
