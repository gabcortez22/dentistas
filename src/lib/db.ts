import { Pool, type PoolClient } from "pg";
import { getEnv } from "@/lib/env";

const globalForPool = globalThis as unknown as { __dentistasPool?: Pool };

export function getPool(): Pool {
  if (!globalForPool.__dentistasPool) {
    const { DATABASE_URL } = getEnv("core");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL);
    globalForPool.__dentistasPool = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      ssl: local ? undefined : { rejectUnauthorized: false },
    });
  }
  return globalForPool.__dentistasPool;
}

export async function closePool(): Promise<void> {
  await globalForPool.__dentistasPool?.end();
  globalForPool.__dentistasPool = undefined;
}

async function inTransaction<T>(
  setup: (client: PoolClient) => Promise<void>,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await setup(client);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Runs fn as the signed-in user: same role and auth.uid() a PostgREST request would have, so RLS applies. */
export function withTenant<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(async (client) => {
    await client.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [userId, JSON.stringify({ sub: userId, role: "authenticated" })],
    );
    await client.query("set local role authenticated");
  }, fn);
}

/** Runs fn as the database owner, bypassing RLS. Only for webhooks, cron and the agent: always scope by clinic_id. */
export function withService<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(async () => {}, fn);
}

/**
 * Who is acting. Services take an Actor and always filter by actor.clinicId, even when RLS would
 * already do it: a user actor runs under RLS, a service actor (webhook, cron, agent) bypasses it.
 */
export type Actor =
  | { kind: "user"; userId: string; clinicId: string; membershipId: string }
  | { kind: "service"; clinicId: string };

export function runAs<T>(actor: Actor, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return actor.kind === "user" ? withTenant(actor.userId, fn) : withService(fn);
}
