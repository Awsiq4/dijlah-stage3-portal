// Secure file storage for lecture PDFs (Vercel Blob). Server-side only — the
// BLOB_READ_WRITE_TOKEN never leaves the server environment.
import {put} from "@vercel/blob";

export const MAX_PDF_BYTES = 20 * 1024 * 1024; // Telegram Bot API document limit

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
