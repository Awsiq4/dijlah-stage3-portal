import {NextRequest, NextResponse} from "next/server";
import {handleUpload, type HandleUploadBody} from "@vercel/blob/client";
import {requireAdmin} from "@/lib/server/auth";
import {validateUploadRequest, UploadRejectedError, MAX_PDF_BYTES_DIRECT} from "@/lib/server/storage";
import {audit} from "@/lib/server/content";
import {dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Direct-to-Blob upload token issuer. The file itself goes straight from the
// browser to Vercel Blob (no 4.5MB function limit); this route only validates
// identity + role + subject authorization + file type/size and issues the token.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req, {write: true});
  if (!admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body || (body.type !== "blob.generate-client-token" && body.type !== "blob.upload-completed")) {
    return NextResponse.json({error: "unsupported upload request"}, {status: 400});
  }
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        let info: Record<string, unknown> = {};
        try { info = JSON.parse(String(clientPayload || "{}")); } catch { throw new UploadRejectedError("invalid client payload"); }
        validateUploadRequest(admin, info); // throws UploadRejectedError (403) on any violation
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_PDF_BYTES_DIRECT,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({adminId: admin.id, email: admin.email, subjectId: info.subjectId || null}),
        };
      },
      onUploadCompleted: async ({blob, tokenPayload}) => {
        let payload: {adminId?: number; email?: string; subjectId?: string | null} = {};
        try { payload = JSON.parse(tokenPayload || "{}"); } catch { /* ignore */ }
        if (dbConfigured()) {
          await audit(payload.email || `admin#${payload.adminId}`, "upload.pdf.direct", {
            url: blob.url, contentType: blob.contentType, subjectId: payload.subjectId,
          });
        }
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    if (err instanceof UploadRejectedError) return NextResponse.json({error: err.message}, {status: 403});
    const msg = err instanceof Error ? err.message : "upload failed";
    return NextResponse.json({error: msg}, {status: 400});
  }
}
