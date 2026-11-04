import {Pool} from "pg";
import {DATABASE_URL, dbConfigured} from "./flags.ts";

let pool: Pool | null = null;

export function getPool(): Pool | null {
  if (!dbConfigured()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: {rejectUnauthorized: false},
      max: 3,
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL is not configured");
  const res = await p.query(sql, params);
  return res.rows as T[];
}

export async function qOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}
