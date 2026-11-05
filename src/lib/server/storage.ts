// Secure file storage for lecture PDFs (Vercel Blob). Server-side only — the
// BLOB_READ_WRITE_TOKEN never leaves the server environment.
import {put} from "@vercel/blob";

export const MAX_PDF_BYTES = 20 * 1024 * 1024; // Telegram Bot API document limit (bot path, server-side)
export const MAX_PDF_BYTES_DIRECT = 100 * 1024 * 1024; // direct-to-Blob uploads bypass the 4.5MB function limit

export function isPdf(buf: Buffer): boolean {
  return buf.length > 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-";
}

export function storageConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function uploadLecturePdf(buf: Buffer, filename: string): Promise<{url: string; name: string}> {
  if (!storageConfigured()) throw new Error("BLOB_READ_WRITE_TOKEN is not configured — file storage unavailable");
  if (!isPdf(buf)) throw new Error("File is not a valid PDF");
  if (buf.length > MAX_PDF_BYTES) throw new Error("File exceeds the 20MB limit");
  const safe = (filename || "lecture.pdf").replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
  const {url} = await put(`lectures/${Date.now()}-${safe}`, buf, {
    access: "public",
    contentType: "application/pdf",
    addRandomSuffix: true,
  });
  return {url, name: safe};
}

// Validation for the direct-to-Blob upload token request (handleUpload onBeforeGenerateToken).
// Checks: authenticated publisher role, PDF type, size cap, and (when given) subject authorization.
import type {AdminInfo} from "./rbac.ts";
import {canUseTelegramPublishing, canPublishSubjectContent, canManageAllContent} from "./rbac.ts";

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
  if (ct !== "application/pdf") throw new UploadRejectedError("only application/pdf is allowed");
  const size = Number(info.size || 0);
  if (!Number.isFinite(size) || size <= 0) throw new UploadRejectedError("invalid size");
  if (size > MAX_PDF_BYTES_DIRECT) throw new UploadRejectedError("file too large (max 100MB direct upload; 20MB via bot)");
  const name = String(info.filename || "");
  if (!/\.pdf$/i.test(name)) throw new UploadRejectedError("filename must end with .pdf");
  if (info.subjectId) {
    const subj = String(info.subjectId);
    if (!canManageAllContent(admin.role)) {
      const subjects = admin.assigned_subjects || [];
      if (!subjects.includes(subj)) throw new UploadRejectedError("forbidden: subject not authorized");
      if (Array.isArray(info.sections) && info.sections.length) {
        if (!canPublishSubjectContent(admin, subj, info.sections.map(String))) throw new UploadRejectedError("forbidden: sections not authorized");
      }
    }
  }
}

export class UploadRejectedError extends Error {
  status = 403;
  constructor(message: string) { super(message); }
}
