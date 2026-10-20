import { afterAll, describe, expect, it } from "vitest";
import { closePool as closeAppPool } from "@/lib/db";
import type { AuthAdmin } from "@/server/clinics";
import { seedDemo } from "../../scripts/seed";
import { closePool, pool } from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

const auth: AuthAdmin = {
  async createUser({ email }) {
    const { rows } = await pool.query<{ id: string }>(
      "insert into auth.users (email) values ($1) returning id",
      [email],
    );
    return { id: rows[0]?.id as string };
  },
  async deleteUser() {},
};
const n = async (sql: string, clinicId: string) =>
  (await pool.query(sql, [clinicId])).rows[0].n as number;

describe("seedDemo", () => {
  it("creates one clinic with 4 members, 8 fake patients, rules and 5 treatments, and is idempotent", async () => {
    const name = `Clínica Demo ${crypto.randomUUID()}`;
    const { clinicId } = await seedDemo(auth, { clinicName: name });
    const snapshot = async () => ({
      members: await n("select count(*)::int as n from memberships where clinic_id = $1", clinicId),
      admins: await n(
        "select count(*)::int as n from memberships where clinic_id = $1 and role = 'admin'",
        clinicId,
      ),
      dentists: await n(
        "select count(*)::int as n from memberships where clinic_id = $1 and role = 'dentist'",
        clinicId,
      ),
      assistants: await n(
        "select count(*)::int as n from memberships where clinic_id = $1 and role = 'assistant'",
        clinicId,
      ),
      patients: await n(
        "select count(*)::int as n from patients where clinic_id = $1 and doc_number like '0000%'",
        clinicId,
      ),
      rules: await n(
        "select count(*)::int as n from availability_rules where clinic_id = $1",
        clinicId,
      ),
      treatments: await n(
        "select count(*)::int as n from treatments where clinic_id = $1",
        clinicId,
      ),
    });
    const first = await snapshot();
    expect(first).toMatchObject({
      members: 4,
      admins: 1,
      dentists: 2,
      assistants: 1,
      patients: 8,
      treatments: 5,
    });
    expect(first.rules).toBeGreaterThan(0);
    const again = await seedDemo(auth, { clinicName: name });
    expect(again.clinicId).toBe(clinicId);
    expect(await snapshot()).toEqual(first);
  });
});
