// Applies database/portal-rbac.sql to the Neon Preview database (idempotent, non-destructive).
// Usage: DATABASE_URL=postgres://... node --experimental-strip-types scripts/apply-portal-rbac.mjs
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Pool} from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATABASE_URL = process.env.DATABASE_URL || "";
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL is required (env). Value is never printed."); process.exit(1); }

const pool = new Pool({connectionString: DATABASE_URL, ssl: {rejectUnauthorized: true}});
try {
  const sql = readFileSync(path.join(root, "database/portal-rbac.sql"), "utf8");
  for (const stmt of sql.split(/;\s*(?:\n|$)/)) {
    const t = stmt.replace(/--[^\n]*/g, "").trim();
    if (t) await pool.query(t);
  }
  const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='portal_lectures' AND column_name='sections'`);
  const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('portal_invitations','portal_link_tokens','portal_telegram_links','portal_bot_state') ORDER BY 1`);
  console.log("migration applied OK; portal_lectures.sections present:", cols.rowCount === 1);
  console.log("new tables:", tables.rows.map(r => r.table_name).join(", "));
} finally {
  await pool.end();
}
