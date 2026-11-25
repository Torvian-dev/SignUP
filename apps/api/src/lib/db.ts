import pg from "pg";
import { env } from "../config/env.js";

export const db = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
});

export type Tx = pg.PoolClient;

/**
 * Run `fn` in a transaction scoped to one tenant. Sets `app.org_id` so the RLS policies in
 * 0001_init.sql apply — any query that forgets a WHERE org_id still cannot leak across tenants.
 */
export async function withOrg<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
