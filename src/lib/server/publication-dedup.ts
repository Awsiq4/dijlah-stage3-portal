import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {safeFileUrl} from "../safe-url.ts";
import {defaultQueryer, type Queryer} from "./db.ts";
import {MAX_PDF_BYTES_DIRECT, isPdf} from "./storage.ts";
import {canModifyContent, canPublishAnnouncement, canPublishMaterial, canPublishSubjectContent, SECTIONS, type AdminInfo} from "./rbac.ts";

export type PublicationKind = "lectures" | "announcements";
export type PublicationOptions = {reviewed?: string; expand?: string; replace?: string};
export type PublicationIssue = {
  kind: "duplicate" | "expand" | "similar";
  id: string;
  title: string;
  url: string;
  canUpdate?: boolean;
  addedSections?: string[];
};

export class PublicationConflict extends Error {
  readonly issue: PublicationIssue;
  constructor(issue: PublicationIssue) {
    super(issue.kind === "similar" ? "يوجد منشور مشابه. راجعه قبل النشر." : issue.kind === "expand" ? "الملزمة منشورة لبعض الشعب." : "هذا المحتوى منشور مسبقًا.");
    this.issue = issue;
  }
}

export async function lockPublication(db: Pick<Queryer, "q">, kind: PublicationKind) {
  await db.q(`INSERT INTO portal_publication_locks (kind) VALUES ($1)
    ON CONFLICT (kind) DO UPDATE SET kind=EXCLUDED.kind`, [kind]);
}

export async function pdfFingerprint(fileUrl: string): Promise<string | null> {
  const url = safeFileUrl(fileUrl);
  if (/^\/lectures\/[a-z0-9_.-]+\.pdf$/i.test(url)) {
    const file = await readFile(join(process.cwd(), "public", url.slice(1))).catch(() => null);
    return file && isPdf(file) ? createHash("sha256").update(file).digest("hex") : null;
  }
  if (!url.startsWith("https://")) return null;
  const blob = new URL(url);
  if (blob.port || !blob.hostname.endsWith(".public.blob.vercel-storage.com") || !blob.pathname.startsWith("/lectures/")) return null;
  const response = await fetch(blob, {redirect: "error", signal: AbortSignal.timeout(20_000)});
  if (!response.ok || !response.body) throw new Error("تعذّر التحقق من ملف PDF. حاول مرة ثانية.");
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  const header = Buffer.alloc(6);
  let bytes = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      if (bytes < header.length) header.set(value.subarray(0, header.length - bytes), bytes);
      bytes += value.length;
      if (bytes > MAX_PDF_BYTES_DIRECT) throw new Error("حجم ملف PDF غير صالح.");
      hash.update(value);
    }
  } finally {
    await reader.cancel();
  }
  if (bytes < header.length || !isPdf(header)) throw new Error("ملف PDF غير صالح.");
  return hash.digest("hex");
}

// Index older PDFs on demand, before opening a publication transaction.
export async function indexLegacyPdfFiles(subjectId: string) {
  const rows = await defaultQueryer.q<{id: string; file_url: string}>(
    `SELECT id,file_url FROM portal_lectures WHERE subject_id=$1 AND file_sha256 IS NULL
     AND status='published' AND archived_at IS NULL ORDER BY created_at DESC LIMIT 8`, [subjectId]
  );
  await Promise.all(rows.map(async row => {
    const hash = await pdfFingerprint(row.file_url).catch(() => null);
    if (hash) await defaultQueryer.q(
      `UPDATE portal_lectures SET file_sha256=$2 WHERE id=$1 AND file_url=$3 AND file_sha256 IS NULL`,
      [row.id, hash, row.file_url]
    );
  }));
}

export const normalizePublicationText = (value: unknown) => String(value ?? "").normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");

type Row = Record<string, unknown> & {id: string; title: string; created_by?: number | null};

function comparableBody(a: string, b: string) {
  const words = (text: string) => new Set(text.match(/[\p{L}\p{N}]+/gu) || []);
  const left = words(a);
  const right = words(b);
  if (left.size < 6 || right.size < 6) return false;
  const common = [...left].filter(word => right.has(word)).length;
  return common / (left.size + right.size - common) >= 0.75;
}

export function publicationUrl(kind: PublicationKind, row: {id: string; sections?: unknown; section?: unknown}) {
  const section = kind === "lectures" ? (Array.isArray(row.sections) && row.sections.length < SECTIONS.length ? row.sections[0] : null) : row.section;
  const query = typeof section === "string" && (SECTIONS as readonly string[]).includes(section) ? "?section=" + section : "";
  return kind === "lectures" ? "/lectures/" + encodeURIComponent(row.id) + query
    : "/announcements" + query + "#announcement-" + encodeURIComponent(row.id);
}

export async function checkPublication(
  db: Pick<Queryer, "q" | "qOne">, admin: AdminInfo, kind: PublicationKind, row: Record<string, unknown>,
  hash: string | null, options: PublicationOptions, checkSimilar = true,
): Promise<{expanded?: Row; replacement?: Row; addedSections?: string[]}> {
  const title = normalizePublicationText(row.title);
  const body = normalizePublicationText(row.body);
  const rows = kind === "lectures"
    ? await db.q<Row>(`SELECT * FROM portal_lectures WHERE subject_id=$1 AND id<>$2
       AND archived_at IS NULL AND status='published' ORDER BY created_at DESC, id`, [row.subject_id, row.id])
    : await db.q<Row>(`SELECT * FROM portal_announcements WHERE scope=$1 AND section=$2 AND subject_id=$3 AND id<>$4
       AND archived_at IS NULL AND created_at >= $5 ORDER BY created_at DESC, id`,
       [row.scope || "general", row.section || "all", row.subject_id || "", row.id, new Date(Date.now() - 24 * 3600_000).toISOString()]);
  const exact = kind === "lectures"
    ? rows.find(old => (hash && old.file_sha256 === hash) || (row.file_url && safeFileUrl(String(old.file_url)) === safeFileUrl(String(row.file_url))))
    : rows.find(old => normalizePublicationText(old.title) === title && normalizePublicationText(old.body) === body);
  if (exact) {
    const requested = Array.isArray(row.sections) && row.sections.length ? row.sections.map(String) : [...SECTIONS];
    const previous = Array.isArray(exact.sections) && exact.sections.length ? exact.sections.map(String) : [...SECTIONS];
    const added = kind === "lectures" ? requested.filter(section => !previous.includes(section)) : [];
    const mayExpand = added.length > 0 && !options.replace && canPublishMaterial(admin, String(row.subject_id), requested);
    if (mayExpand && options.expand === exact.id) {
      const sections = SECTIONS.filter(section => previous.includes(section) || requested.includes(section));
      await db.q(`UPDATE portal_lectures SET sections=$2 WHERE id=$1`, [exact.id, JSON.stringify(sections)]);
      return {expanded: exact, addedSections: added};
    }
    throw new PublicationConflict({kind: mayExpand ? "expand" : "duplicate", id: exact.id, title: exact.title, url: publicationUrl(kind, exact), addedSections: mayExpand ? added : undefined});
  }
  if (options.expand) throw new Error("المنشور المطلوب غير صالح. راجع المعاينة.");
  const similar = checkSimilar && rows.find(old => normalizePublicationText(old.title) === title ||
    (kind === "announcements" && comparableBody(body, normalizePublicationText(old.body))));
  if (similar) {
    const sections = Array.isArray(similar.sections) && similar.sections.length ? similar.sections.map(String) : [...SECTIONS];
    const mayUpdate = canModifyContent(admin, similar) && (kind === "lectures"
      ? canPublishMaterial(admin, String(similar.subject_id), sections)
      : similar.scope === "teacher"
        ? canPublishSubjectContent(admin, String(similar.subject_id), similar.section === "all" ? [...SECTIONS] : [String(similar.section)])
        : canPublishAnnouncement(admin, String(similar.scope), String(similar.section)));
    if (options.replace === similar.id && mayUpdate) return {replacement: similar};
    if (options.reviewed !== similar.id || options.replace) {
      throw new PublicationConflict({kind: "similar", id: similar.id, title: similar.title, url: publicationUrl(kind, similar), canUpdate: mayUpdate});
    }
  }
  if (options.replace) throw new Error("المنشور المطلوب غير صالح. راجع المعاينة.");
  return {};
}
