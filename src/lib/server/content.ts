import {defaultQueryer, type Queryer} from "./db.ts";
import {dbConfigured} from "./flags.ts";
import {SEED} from "../seed.ts";
import {SCHEMAS, sanitizeRow, buildUpsert, TELEGRAM_KINDS, type ContentType, type WritableContentType} from "./content-schema.ts";

export {sanitizeRow, buildUpsert, TELEGRAM_KINDS, SCHEMAS};
export type {ContentType, WritableContentType};

export function contentFromSeed(type: ContentType) {
  if (type === "telegram") {
    return [
      {kind: "general", key: "general", url: SEED.telegram.general},
      ...Object.entries(SEED.telegram.sections).map(([k, url]) => ({kind: "section", key: k, url})),
      ...Object.entries(SEED.telegram.subjects).map(([k, url]) => ({kind: "subject", key: k, url})),
    ];
  }
  return [...(SEED[type] as unknown as Record<string, unknown>[])];
}

export async function listContent(type: ContentType, db: Queryer = defaultQueryer, ownerId?: number): Promise<Record<string, unknown>[]> {
  if (type === "telegram") {
    if (!dbConfigured()) return contentFromSeed("telegram");
    return db.q(`SELECT kind, key, url FROM portal_telegram ORDER BY kind, key`);
  }
  if (!dbConfigured()) return contentFromSeed(type);
  const table = SCHEMAS[type].table;
  if (ownerId !== undefined) return db.q(`SELECT * FROM ${table} WHERE created_by=$1 ORDER BY 1`, [ownerId]);
  return db.q(`SELECT * FROM ${table} ORDER BY 1`);
}

export async function createContent(type: Exclude<ContentType, "telegram">, row: Record<string, unknown>, db: Queryer = defaultQueryer): Promise<void> {
  const {sql, params} = buildUpsert(type, row);
  await db.q(sql, params);
}

export async function deleteContent(type: Exclude<ContentType, "telegram">, id: string, db: Queryer = defaultQueryer): Promise<void> {
  const table = SCHEMAS[type].table;
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("معرّف غير صالح");
  await db.q(`DELETE FROM ${table} WHERE id=$1`, [id]);
}

export async function upsertTelegram(kind: string, key: string, url: string, db: Queryer = defaultQueryer): Promise<void> {
  if (!(TELEGRAM_KINDS as readonly string[]).includes(kind)) throw new Error("نوع قناة غير صالح");
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error("مفتاح قناة غير صالح");
  if (url && !/^https:\/\/(t\.me|telegram\.me)\//.test(url)) throw new Error("الرابط يجب أن يكون رابط تليجرام https صالحًا");
  await db.q(
    `INSERT INTO portal_telegram (kind, key, url) VALUES ($1,$2,$3) ON CONFLICT (kind,key) DO UPDATE SET url=EXCLUDED.url`,
    [kind, key, url]
  );
}

// Required audit: errors PROPAGATE so that, inside withTx(), the content change
// and its audit record commit or roll back together.
export async function audit(actor: string, action: string, detail: unknown, db: Queryer = defaultQueryer): Promise<void> {
  await db.q(`INSERT INTO portal_audit (actor, action, detail) VALUES ($1,$2,$3)`, [actor, action, JSON.stringify(detail ?? null)]);
}

// Best-effort audit for authentication attempts only (documented policy):
// a login must never fail, and no error details may leak, because of audit logging.
export async function auditBestEffort(actor: string, action: string, detail: unknown, db: Queryer = defaultQueryer): Promise<void> {
  try {
    await db.q(`INSERT INTO portal_audit (actor, action, detail) VALUES ($1,$2,$3)`, [actor, action, JSON.stringify(detail ?? null)]);
  } catch (err) {
    console.warn("audit (best-effort) failed:", err instanceof Error ? err.message : err);
  }
}
