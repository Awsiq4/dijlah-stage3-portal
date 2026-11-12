// Dedicated Telegram past-exam question bank; does not modify student website pages.
// Database table is added by database/portal-past-questions.sql.
import {withTx, q, qOne} from "./db.ts";
import {canModifyContent, canPublishMaterial, isActive, type AdminInfo} from "./rbac.ts";
import {safeFileUrl} from "../safe-url.ts";
import {put} from "@vercel/blob";
import {MAX_PDF_BYTES, storageConfigured} from "./storage.ts";

const ALL = ["A", "B", "C", "F"] as const;
export type ExamKind = "quiz" | "midterm" | "final";
export const EXAM_KINDS: Record<ExamKind, string> = {quiz: "امتحان يومي", midterm: "Midterm", final: "Final"};

export const validExamKind = (value: unknown): value is ExamKind =>
  value === "quiz" || value === "midterm" || value === "final";

export type PastQuestion = {
  id: string; subject_id: string; exam_kind: ExamKind; title: string;
  academic_year: string; file_url: string; file_name: string; created_by: number;
  sections: string[]; archived_at?: string | null; created_at: string;
};

export function questionImageMime(filename: string, bytes: Buffer): string | null {
  if (/\.jpe?g$/i.test(filename) && bytes.length >= 3 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (/\.png$/i.test(filename) && bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  return null;
}

export async function uploadQuestionImage(bytes: Buffer, filename: string) {
  if (!storageConfigured() || bytes.length === 0 || bytes.length > MAX_PDF_BYTES) throw new Error("التخزين غير متاح أو الملف كبير");
  const mime = questionImageMime(filename, bytes);
  if (!mime) throw new Error("صيغة الصورة غير صالحة");
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(-75);
  return put("past-questions/" + Date.now() + "-" + safe, bytes, {
    access: "public", contentType: mime, addRandomSuffix: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

export async function questionBankReady(): Promise<boolean> {
  const row = await qOne<{exists: boolean}>("SELECT to_regclass('public.portal_past_questions') IS NOT NULL AS exists");
  return Boolean(row?.exists);
}

export async function publishPastQuestion(admin: AdminInfo, input: {
  id: string; subjectId: string; examKind: ExamKind; title: string;
  academicYear?: string; sections: string[]; fileUrl: string; fileName: string; fingerprint: string;
}): Promise<{ok: true; id: string; inserted: boolean; url: string} | {ok: false; error: string}> {
  if (!isActive(admin) || !canPublishMaterial(admin, input.subjectId, input.sections))
    return {ok: false, error: "لا تملك صلاحية النشر لهذه المادة أو الشعب"};
  if (!validExamKind(input.examKind) || !input.title.trim() || !/^[-a-zA-Z0-9]{10,100}$/.test(input.fingerprint)
      || !input.sections.length || !input.sections.every(s => ALL.includes(s as (typeof ALL)[number]))
      || !/^https:\/\//.test(input.fileUrl) || !safeFileUrl(input.fileUrl))
    return {ok: false, error: "بيانات أسئلة الامتحان غير صالحة"};
  if (!await questionBankReady()) return {ok: false, error: "بنك الأسئلة قيد الإعداد، ولم تُفعّل قاعدة بياناته بعد"};
  const title = input.title.trim().slice(0, 180);
  return withTx(async tx => {
    // The unique index prevents concurrent duplicate files across publishers.
    const row = await tx.qOne<{id: string}>(
      `INSERT INTO portal_past_questions
       (id,subject_id,exam_kind,title,academic_year,sections,file_url,file_name,file_sha256,created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING RETURNING id`,
      [input.id, input.subjectId, input.examKind, title, (input.academicYear || "").slice(0, 40),
       JSON.stringify(input.sections), input.fileUrl, input.fileName.slice(0, 120), input.fingerprint, admin.id]
    );
    if (row) {
      await tx.q("INSERT INTO portal_audit(actor,action,detail) VALUES($1,$2,$3)",
        [admin.email, "telegram.question.publish", {id: row.id, subjectId: input.subjectId, examKind: input.examKind}]);
      return {ok: true as const, id: row.id, inserted: true, url: input.fileUrl};
    }
    const existing = await tx.qOne<{id:string;file_url:string}>(
      "SELECT id,file_url FROM portal_past_questions WHERE subject_id=$1 AND exam_kind=$2 AND file_sha256=$3 AND archived_at IS NULL",
      [input.subjectId, input.examKind, input.fingerprint]
    );
    return existing
      ? {ok: true as const, id: existing.id, inserted: false, url: existing.file_url}
      : {ok: false as const, error: "هذا الملف محفوظ مسبقاً أو توجد محاولة نشر متزامنة"};
  });
}

export async function listPastQuestions(subjectId: string, section: string, kind?: ExamKind, page = 0) {
  if (!ALL.includes(section as (typeof ALL)[number]) || !await questionBankReady()) return [];
  const vals: unknown[] = [subjectId, JSON.stringify([section])];
  const filter = kind ? " AND exam_kind=$3" : "";
  if (kind) vals.push(kind);
  vals.push(Math.min(Math.max(0, page), 100) * 12);
  const offset = vals.length;
  return q<PastQuestion>(`SELECT id,subject_id,exam_kind,title,academic_year,file_url,file_name,created_by,sections,created_at
    FROM portal_past_questions WHERE subject_id=$1 AND sections @> $2::jsonb AND archived_at IS NULL${filter}
    ORDER BY created_at DESC LIMIT 12 OFFSET $${offset}`, vals);
}

export async function listOwnQuestions(admin: AdminInfo, page = 0) {
  if (!isActive(admin) || !await questionBankReady()) return [];
  const privileged = admin.role === "super_admin" || admin.role === "editor";
  return q<PastQuestion>(
    `SELECT id,subject_id,exam_kind,title,academic_year,file_url,file_name,created_by,sections,created_at,archived_at
     FROM portal_past_questions ${privileged ? "" : "WHERE created_by=$1"} ORDER BY created_at DESC LIMIT 12 OFFSET $${privileged ? 1 : 2}`,
    privileged ? [Math.max(page, 0) * 12] : [admin.id, Math.max(page, 0) * 12]
  );
}

export async function modifyPastQuestion(admin: AdminInfo, id: string, action: "archive" | "restore" | "delete") {
  if (!isActive(admin) || !await questionBankReady()) return false;
  return withTx(async tx => {
    const row = await tx.qOne<{created_by:number}>("SELECT created_by FROM portal_past_questions WHERE id=$1 FOR UPDATE", [id]);
    if (!row || !canModifyContent(admin,row)) return false;
    if (action === "delete") await tx.q("DELETE FROM portal_past_questions WHERE id=$1", [id]);
    else await tx.q("UPDATE portal_past_questions SET archived_at=$2 WHERE id=$1", [id, action === "archive" ? new Date().toISOString() : null]);
    await tx.q("INSERT INTO portal_audit(actor,action,detail) VALUES($1,$2,$3)",
      [admin.email, "telegram.question." + action, {id}]);
    return true;
  });
}
