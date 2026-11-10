// Pure schema validation for admin content writes.
import {safeFileUrl} from "../safe-url.ts";

export type ContentType = "subjects" | "lectures" | "announcements" | "exams" | "assignments" | "schedule" | "telegram";
export type WritableContentType = Exclude<ContentType, "telegram">;

type FieldDef = {col: string; kind: "text" | "int" | "json"; required?: boolean; oneOf?: readonly string[]};

// Explicit per-table allowlists: ONLY these column identifiers may ever appear in SQL.
// Request data can never influence identifiers — only bound parameter values.
export const SCHEMAS: Record<WritableContentType, {table: string; fields: FieldDef[]}> = {
  subjects: {table: "portal_subjects", fields: [
    {col: "id", kind: "text", required: true},
    {col: "name", kind: "text", required: true},
    {col: "english_name", kind: "text"},
    {col: "teacher", kind: "text"},
    {col: "description", kind: "text"},
    {col: "color", kind: "text"},
  ]},
  lectures: {table: "portal_lectures", fields: [
    {col: "id", kind: "text", required: true},
    {col: "subject_id", kind: "text", required: true},
    {col: "number", kind: "int", required: true},
    {col: "title", kind: "text", required: true},
    {col: "description", kind: "text"},
    {col: "file_url", kind: "text"},
    {col: "file_name", kind: "text"},
    {col: "material_kind", kind: "text", oneOf: ["lecture", "summary"]},
    {col: "sections", kind: "json"},
    {col: "status", kind: "text", oneOf: ["published", "draft"]},
    {col: "archived_at", kind: "text"},
    {col: "updated_at", kind: "text"},
  ]},
  announcements: {table: "portal_announcements", fields: [
    {col: "id", kind: "text", required: true},
    {col: "title", kind: "text", required: true},
    {col: "body", kind: "text"},
    {col: "scope", kind: "text", oneOf: ["general", "section", "teacher"]},
    {col: "section", kind: "text"},
    {col: "subject_id", kind: "text"},
    {col: "author", kind: "text"},
    {col: "priority", kind: "text", oneOf: ["normal", "important", "urgent"]},
    {col: "published_at", kind: "text"},
    {col: "pinned", kind: "text", oneOf: ["true", "false"]},
  ]},
  exams: {table: "portal_exams", fields: [
    {col: "id", kind: "text", required: true},
    {col: "subject_id", kind: "text"},
    {col: "title", kind: "text", required: true},
    {col: "type", kind: "text"},
    {col: "date", kind: "text"},
    {col: "start_time", kind: "text"},
    {col: "room", kind: "text"},
    {col: "sections", kind: "json"},
    {col: "topics", kind: "text"},
    {col: "notes", kind: "text"},
    {col: "status", kind: "text", oneOf: ["confirmed", "provisional", "cancelled"]},
  ]},
  assignments: {table: "portal_assignments", fields: [
    {col: "id", kind: "text", required: true},
    {col: "subject_id", kind: "text"},
    {col: "title", kind: "text", required: true},
    {col: "instructions", kind: "text"},
    {col: "assigned_at", kind: "text"},
    {col: "due_at", kind: "text"},
    {col: "sections", kind: "json"},
    {col: "submission", kind: "text"},
    {col: "status", kind: "text", oneOf: ["active", "closed", "cancelled"]},
    {col: "attachment_url", kind: "text"},
  ]},
  schedule: {table: "portal_schedule", fields: [
    {col: "id", kind: "text", required: true},
    {col: "section", kind: "text", required: true, oneOf: ["A", "B", "C", "F"]},
    {col: "day", kind: "int", required: true},
    {col: "start", kind: "text", required: true},
    {col: "end", kind: "text", required: true},
    {col: "subject_id", kind: "text"},
    {col: "teacher", kind: "text"},
    {col: "room", kind: "text"},
    {col: "kind", kind: "text", oneOf: ["theory", "practical"]},
    {col: "status", kind: "text", oneOf: ["normal", "moved", "cancelled", "extra"]},
    {col: "note", kind: "text"},
    {col: "periods", kind: "json"},
  ]},
};


export const TELEGRAM_KINDS = ["general", "section", "subject"] as const;

function coerce(field: FieldDef, value: unknown): unknown {
  if (value === undefined || value === null || value === "") return field.kind === "int" ? null : "";
  if (field.kind === "int") {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new Error(`حقل ${field.col} يجب أن يكون عددًا صحيحًا`);
    return n;
  }
  if (field.kind === "json") {
    if (typeof value === "string") { try { return JSON.parse(value); } catch { throw new Error(`حقل ${field.col} يجب أن يكون JSON صالحًا`); } }
    if (typeof value !== "object") throw new Error(`حقل ${field.col} يجب أن يكون JSON صالحًا`);
    return value;
  }
  const s = String(value);
  if ((field.col === "file_url" || field.col === "attachment_url") && !safeFileUrl(s)) {
    throw new Error(`رابط غير صالح: ${field.col}`);
  }
  if (field.oneOf && !field.oneOf.includes(s)) throw new Error(`قيمة غير مسموحة لحقل ${field.col}: ${s}`);
  return s;
}

// Validates + sanitizes an untrusted row against the allowlist. Unknown columns are dropped.
export function sanitizeRow(type: Exclude<ContentType, "telegram">, row: Record<string, unknown>): Record<string, unknown> {
  const schema = SCHEMAS[type];
  if (!schema) throw new Error("نوع محتوى غير صالح");
  if (!row || typeof row !== "object") throw new Error("row يجب أن يكون كائنًا");
  const out: Record<string, unknown> = {};
  for (const field of schema.fields) {
    if (field.col in row) {
      out[field.col] = field.kind === "json"
        ? (row[field.col] === undefined || row[field.col] === null || row[field.col] === "" ? null : coerce(field, row[field.col]))
        : coerce(field, row[field.col]);
    }
  }
  for (const field of schema.fields) {
    if (field.required && (out[field.col] === undefined || out[field.col] === "" || out[field.col] === null)) {
      throw new Error(`الحقل المطلوب مفقود: ${field.col}`);
    }
  }
  if (out.sections != null && (!Array.isArray(out.sections) || out.sections.some(s => !["A", "B", "C", "F"].includes(s)))) {
    throw new Error("قيمة غير مسموحة لحقل sections");
  }
  return out;
}

// Pure SQL builder — identifiers come only from SCHEMAS, values are always $n placeholders.
// mode "update" (default, for admin edits) refreshes an existing row;
// mode "nothing" (seed migration default) NEVER overwrites existing rows — preserves admin edits.
export function buildUpsert(type: Exclude<ContentType, "telegram">, rawRow: Record<string, unknown>, mode: "update" | "nothing" = "update", owner?: {id: number; source: "web" | "telegram"}): {sql: string; params: unknown[]} {
  const schema = SCHEMAS[type];
  const row = sanitizeRow(type, rawRow);
  if (owner) {
    row.created_by = owner.id;
    row.source = owner.source;
  }
  const cols = Object.keys(row);
  if (!cols.length) throw new Error("لا توجد حقول صالحة للإدراج");
  const q = (c: string) => `"${c}"`; // always quote identifiers (reserved words like "end" included)
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const sets = cols.filter(c => c !== "id" && c !== "created_by" && c !== "source").map(c => `${q(c)}=EXCLUDED.${q(c)}`).join(",");
  let sql = `INSERT INTO ${schema.table} (${cols.map(q).join(",")}) VALUES (${placeholders})`;
  if (mode === "nothing") sql += " ON CONFLICT (id) DO NOTHING";
  else sql += sets ? ` ON CONFLICT (id) DO UPDATE SET ${sets}` : " ON CONFLICT (id) DO NOTHING";
  if (mode === "nothing") sql += owner ? " RETURNING id, created_by" : " RETURNING id"; // lets callers count actually-inserted rows
  const params = cols.map(c => (typeof row[c] === "object" && row[c] !== null ? JSON.stringify(row[c]) : row[c]));
  return {sql, params};
}


// Update only the record still owned by this account, even after a concurrent insert.
export function buildOwnedUpdate(type: WritableContentType, row: Record<string, unknown>, ownerId: number) {
  const fields = Object.entries(sanitizeRow(type, row)).filter(([key]) => key !== "id");
  const sets = fields.map(([key], i) => `"${key}"=$${i + 3}`).join(",");
  const values = fields.map(([, value]) => value !== null && typeof value === "object" ? JSON.stringify(value) : value);
  return {
    sql: `UPDATE ${SCHEMAS[type].table} SET ${sets} WHERE id=$1 AND created_by=$2 RETURNING id`,
    params: [row.id, ownerId, ...values],
  };
}
