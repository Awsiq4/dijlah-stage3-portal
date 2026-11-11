import {NextRequest, NextResponse} from "next/server";
import {del} from "@vercel/blob";
import {handleUpload, type HandleUploadBody} from "@vercel/blob/client";
import {checkLoginRateLimit, requireAdmin} from "@/lib/server/auth";
import {validateUploadRequest, UploadRejectedError, MAX_PDF_BYTES_DIRECT, isPdf, isPptxHeader, PPTX_MIME} from "@/lib/server/storage";
import {audit} from "@/lib/server/content";
import {dbConfigured} from "@/lib/server/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Direct-to-Blob upload token issuer. The file itself goes straight from the
// browser to Vercel Blob (no 4.5MB function limit); this route only validates
// identity + role + subject authorization + file type/size and issues the token.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body || (body.type !== "blob.generate-client-token" && body.type !== "blob.upload-completed")) {
    return NextResponse.json({error: "unsupported upload request"}, {status: 400});
  }
  const admin = body.type === "blob.generate-client-token" ? await requireAdmin(req, {write: true}) : null;
  if (body.type === "blob.generate-client-token" && !admin) return NextResponse.json({error: "unauthorized"}, {status: 401});
  if (body.type === "blob.upload-completed" && !req.headers.has("x-vercel-signature")) {
    return NextResponse.json({error: "unauthorized"}, {status: 401});
  }
  try {
    const json = await handleUpload({
      // The production Blob connection does not allow OIDC yet; use the
      // server-only read/write token for browser token issuance and callbacks.
      token: process.env.BLOB_READ_WRITE_TOKEN,
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!admin || !/^lectures\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,96}\.(?:pdf|pptx)$/i.test(pathname)) {
          throw new UploadRejectedError("invalid upload path");
        }
        let info: Record<string, unknown> = {};
        try { info = JSON.parse(String(clientPayload || "{}")); } catch { throw new UploadRejectedError("invalid client payload"); }
        if (typeof info?.subjectId !== "string" || !info.subjectId || !Array.isArray(info.sections) || !info.sections.length ||
            !info.sections.every(section => ["A", "B", "C", "F"].includes(section))) {
          throw new UploadRejectedError("valid subject and audience required");
        }
        if (!await checkLoginRateLimit(`upload:${admin.id}`, 25, 60 * 60_000)) {
          throw new UploadRejectedError("upload rate limit reached");
        }
        validateUploadRequest(admin, info); // throws UploadRejectedError (403) on any violation
        return {
          allowedContentTypes: ["application/pdf", PPTX_MIME],
          maximumSizeInBytes: MAX_PDF_BYTES_DIRECT,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + 15 * 60_000,
          tokenPayload: JSON.stringify({adminId: admin.id, email: admin.email, subjectId: info.subjectId || null}),
        };
      },
      onUploadCompleted: async ({blob, tokenPayload}) => {
        let payload: {adminId?: number; email?: string; subjectId?: string | null} = {};
        try { payload = JSON.parse(tokenPayload || "{}"); } catch { /* ignore */ }
        const fileUrl = new URL(blob.url);
        if (fileUrl.protocol !== "https:" || !fileUrl.hostname.endsWith(".public.blob.vercel-storage.com") ||
            !fileUrl.pathname.startsWith("/lectures/")) throw new UploadRejectedError("invalid storage URL");
        const response = await fetch(fileUrl, {
          headers: {Range: "bytes=0-5"},
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new Error("File verification unavailable");
        }
        const reader = response.body.getReader();
        const header = Buffer.alloc(6);
        let bytes = 0;
        try {
          while (bytes < header.length) {
            const {value, done} = await reader.read();
            if (done) break;
            const chunk = value.subarray(0, header.length - bytes);
            header.set(chunk, bytes);
            bytes += chunk.length;
          }
        } finally {
          await reader.cancel();
        }
        const isPresentation = /\.pptx$/i.test(fileUrl.pathname);
        const valid = isPresentation
          ? blob.contentType === PPTX_MIME && isPptxHeader(header.subarray(0, bytes))
          : /\.pdf$/i.test(fileUrl.pathname) && blob.contentType === "application/pdf" && isPdf(header.subarray(0, bytes));
        if (!valid) {
          await del(fileUrl.href, {token: process.env.BLOB_READ_WRITE_TOKEN});
          if (dbConfigured()) await audit(payload.email || `admin#${payload.adminId}`, "upload.file.rejected", {subjectId: payload.subjectId});
          return;
        }
        if (dbConfigured()) {
          await audit(payload.email || `admin#${payload.adminId}`, "upload.file.direct", {
            url: blob.url, contentType: blob.contentType, subjectId: payload.subjectId,
          });
        }
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    if (err instanceof UploadRejectedError) return NextResponse.json({error: err.message}, {status: 403});
    const callback = body.type === "blob.upload-completed";
    const badSignature = err instanceof Error && /callback signature/i.test(err.message);
    return NextResponse.json({error: "upload failed"}, {status: callback ? (badSignature ? 401 : 503) : 400});
  }
}
