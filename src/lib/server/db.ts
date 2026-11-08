import {Pool, type PoolClient} from "pg";
import {DATABASE_URL, dbConfigured} from "./flags.ts";

let pool: Pool | null = null;

export function getPool(): Pool | null {
  if (!dbConfigured()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      // TLS certificate verification is REQUIRED (Neon and other hosted Postgres
      // use publicly trusted CAs). Never disable rejectUnauthorized in code.
      ssl: {rejectUnauthorized: true},
      max: 3,
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export type Queryer = {
  q: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  qOne: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T | null>;
};

const defaultQueryer: Queryer = {
  q: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    const p = getPool();
    if (!p) throw new Error("DATABASE_URL is not configured");
    const res = await p.query(sql, params);
    return res.rows as T[];
  },
  qOne: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    const rows = await defaultQueryer.q<T>(sql, params);
    return rows[0] ?? null;
  },
};

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return defaultQueryer.q<T>(sql, params);
}

export async function qOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  return defaultQueryer.qOne<T>(sql, params);
}

function txQueryer(client: PoolClient): Queryer {
  return {
    q: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      const res = await client.query(sql, params);
      return res.rows as T[];
    },
    qOne: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      const res = await client.query(sql, params);
      return (res.rows[0] ?? null) as T | null;
    },
  };
}

// Runs fn inside a single DB transaction; rolls back on any error.
export async function withTx<T>(fn: (db: Queryer) => Promise<T>): Promise<T> {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL is not configured");
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(txQueryer(client));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// Test hook: inject a pg-compatible pool (e.g. pg-mem) without touching env/config.
export function setPoolForTests(p: Pool | null): void {
  pool = p;
}

export {defaultQueryer};
