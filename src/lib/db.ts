import { Pool, type PoolClient } from "pg";
const globalDb = globalThis as unknown as { izPool?: Pool };
export const db =
  globalDb.izPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 3000,
  });
if (process.env.NODE_ENV !== "production") globalDb.izPool = db;
export async function tx<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
