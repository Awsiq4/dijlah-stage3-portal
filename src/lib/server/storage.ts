// Secure file storage for lecture PDFs and PPTX presentations (Vercel Blob). Server-side only — the
// BLOB_READ_WRITE_TOKEN never leaves the server environment.
import {put} from "@vercel/blob";

export const MAX_PDF_BYTES = 20 * 1024 * 1024; // Telegram Bot API document limit (bot path, server-side)
export const MAX_PDF_BYTES_DIRECT = 100 * 1024 * 1024; // direct-to-Blob uploads bypass the 4.5MB function limit

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const PDF_MIME = "application/pdf";

export function materialMime(filename: string): string | null {
  if (/\.pdf$/i.test(filename)) return PDF_MIME;
  if (/\.pptx$/i.test(filename)) return PPTX_MIME;
  return null;
}

export function isPdf(buf: Buffer): boolean {
  return buf.length > 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

// PPTX is an Open XML ZIP package. Do not mistake arbitrary ZIPs for presentations.
export function isPptxHeader(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b &&
    buf[2] === 0x03 && buf[3] === 0x04;
}
export function isPptx(buf: Buffer): boolean {
  return isPptxHeader(buf) && buf.includes(Buffer.from("[Content_Types].xml")) &&
    buf.includes(Buffer.from("ppt/presentation.xml"));
}

export function validMaterialFile(buf: Buffer, filename: string): boolean {
  const mime = materialMime(filename);
  return mime === PDF_MIME ? isPdf(buf) : mime === PPTX_MIME ? isPptx(buf) : false;
}

export function storageConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function uploadLectureFile(buf: Buffer, filename: string): Promise<{url: string; name: string}> {
  if (!storageConfigured()) throw new Error("BLOB_READ_WRITE_TOKEN is not configured — file storage unavailable");
  const mime = materialMime(filename);
  if (!mime || !validMaterialFile(buf, filename)) throw new Error("File is not a valid PDF/PPTX");
  if (buf.length > MAX_PDF_BYTES) throw new Error("File exceeds the 20MB limit");
  const safe = (filename || "lecture.pdf").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  // Retry only transient network/service errors; invalid credentials and
  // permanent 4xx responses must be reported, not retried.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const {url} = await put(`lectures/${Date.now()}-${safe}`, buf, {
        access: "public",
        contentType: mime,
        addRandomSuffix: true,
        // The store's OIDC project connection covers Preview only. An explicit
        // server-side read/write token takes precedence over Vercel's OIDC
        // credentials until Production is added to that connection.
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      return {url, name: safe};
    } catch (error) {
      const candidate = error as {status?: number; statusCode?: number; code?: string};
      const status = candidate?.status ?? candidate?.statusCode;
      const code = String(candidate?.code ?? "");
      const msg = error instanceof Error ? error.message : "";
      const transient = status === 429 || (typeof status === "number" && status >= 500) ||
        /^(ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT)$/.test(code) ||
        /(?:fetch failed|network error|socket hang up|timed? out)/i.test(msg);
      if (!transient || attempt > 0) throw error;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
  throw new Error("Unable to upload material after retry");
}

// Validation for the direct-to-Blob upload token request (handleUpload onBeforeGenerateToken).
// Checks: authenticated publisher role, PDF/PPTX type, size cap, and (when given) subject authorization.
import type {AdminInfo} from "./rbac.ts";
import {canUseTelegramPublishing, canPublishMaterial} from "./rbac.ts";

export interface UploadRequestInfo {
  filename: string;
  contentType: string;
  size: number;
  subjectId?: string;
  sections?: string[];
}

export function validateUploadRequest(admin: AdminInfo, info: Partial<UploadRequestInfo>): void {
  if (!canUseTelegramPublishing(admin)) throw new UploadRejectedError("forbidden: role cannot upload");
  const ct = String(info.contentType || "");
  const name = String(info.filename || "");
  if (!materialMime(name) || materialMime(name) !== ct) throw new UploadRejectedError("only PDF or PPTX files with matching content types are allowed");
  const size = Number(info.size || 0);
  if (!Number.isFinite(size) || size <= 0) throw new UploadRejectedError("invalid size");
  if (size > MAX_PDF_BYTES_DIRECT) throw new UploadRejectedError("file too large (max 100MB direct upload; 20MB via bot)");
  // Same server-side policy as lecture publishing (rbac.canPublishMaterial):
  // section rep -> any valid subject, audience = own section OR all sections;
  // general rep -> any subject, all or single section; teacher -> assigned subjects + permitted sections.
  // The final authorization still happens again on POST /api/admin/content.
  if (info.subjectId) {
    const subj = String(info.subjectId);
    const sections = Array.isArray(info.sections) && info.sections.length ? info.sections.map(String) : ["A", "B", "C", "F"];
    if (!canPublishMaterial(admin, subj, sections)) throw new UploadRejectedError("forbidden: subject or audience not authorized");
  }
}

export class UploadRejectedError extends Error {
  status = 403;
  constructor(message: string) { super(message); }
}
