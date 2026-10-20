import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

export const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

export type Role = "admin" | "dentist" | "assistant";

export async function createUser(email = `${randomUUID()}@test.local`): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return rows[0]?.id as string;
}

export async function createClinic(name = "Clínica de prueba"): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    "insert into clinics (name) values ($1) returning id",
    [name],
  );
  return rows[0]?.id as string;
}

export async function addMember(clinicId: string, role: Role, displayName: string = role) {
  const userId = await createUser();
  const { rows } = await pool.query<{ id: string }>(
    "insert into memberships (clinic_id, user_id, role, display_name) values ($1, $2, $3, $4) returning id",
    [clinicId, userId, role, displayName],
  );
  return { userId, membershipId: rows[0]?.id as string };
}

export async function seedClinic() {
  const clinicId = await createClinic();
  const admin = await addMember(clinicId, "admin", "Admin");
  const dentist = await addMember(clinicId, "dentist", "Dra. Prueba");
  const assistant = await addMember(clinicId, "assistant", "Asistente");
  return { clinicId, admin, dentist, assistant };
}

/** Runs fn in a transaction as the `authenticated` role with auth.uid() = userId, like a request would. */
export async function asUser<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
      [userId, JSON.stringify({ sub: userId, role: "authenticated" })],
    );
    await client.query("set local role authenticated");
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

export async function closePool() {
  await pool.end();
}

/** Inserts a minimal patient directly (owner role) for tests that need one. */
export async function createPatientRow(
  clinicId: string,
  docNumber = String(Math.random()).slice(2, 10),
) {
  const { rows } = await pool.query<{ id: string }>(
    "insert into patients (clinic_id, hc_number, doc_number, last_name, first_name) values ($1, $2, $2, 'Pérez', 'Ana') returning id",
    [clinicId, docNumber],
  );
  return rows[0]?.id as string;
}
