import { afterAll, describe, expect, it } from "vitest";
import { closePool as closeAppPool, runAs, withService, withTenant } from "@/lib/db";
import {
  addMember,
  asUser,
  closePool,
  createClinic,
  createUser,
  pool,
  seedClinic,
} from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

describe("tenancy foundation", () => {
  it("a member sees only their own clinic and its memberships", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    const clinics = await asUser(a.admin.userId, (c) => c.query("select id from clinics"));
    expect(clinics.rows).toEqual([{ id: a.clinicId }]);
    const members = await asUser(a.assistant.userId, (c) =>
      c.query("select clinic_id from memberships"),
    );
    expect(members.rows.every((r) => r.clinic_id === a.clinicId)).toBe(true);
    expect(members.rowCount).toBe(3);
    const other = await asUser(b.admin.userId, (c) =>
      c.query("select id from clinics where id = $1", [a.clinicId]),
    );
    expect(other.rowCount).toBe(0);
  });

  it("only an admin can add memberships to a clinic", async () => {
    const a = await seedClinic();
    const newUser = await createUser();
    const insert = (userId: string) =>
      asUser(userId, (c) =>
        c.query(
          "insert into memberships (clinic_id, user_id, role, display_name) values ($1, $2, 'assistant', 'Nueva')",
          [a.clinicId, newUser],
        ),
      );
    await expect(insert(a.dentist.userId)).rejects.toThrow(/row-level security/);
    await insert(a.admin.userId);
  });

  it("a user belongs to at most one clinic", async () => {
    const a = await seedClinic();
    const b = await createClinic();
    await expect(
      pool.query(
        "insert into memberships (clinic_id, user_id, role, display_name) values ($1, $2, 'dentist', 'Doble')",
        [b, a.dentist.userId],
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("authenticated can never delete or truncate, and anon has no access", async () => {
    const privilege = async (role: string, table: string, op: string) =>
      (await pool.query("select has_table_privilege($1, $2, $3) as ok", [role, table, op])).rows[0]
        .ok as boolean;
    expect(await privilege("authenticated", "clinics", "DELETE")).toBe(false);
    expect(await privilege("authenticated", "memberships", "TRUNCATE")).toBe(false);
    expect(await privilege("anon", "clinics", "SELECT")).toBe(false);
    const a = await seedClinic();
    await expect(
      asUser(a.admin.userId, (c) =>
        c.query("delete from memberships where clinic_id = $1", [a.clinicId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("withTenant applies RLS and withService bypasses it", async () => {
    const a = await seedClinic();
    await seedClinic();
    const tenant = await withTenant(a.dentist.userId, (c) => c.query("select id from clinics"));
    expect(tenant.rowCount).toBe(1);
    const service = await withService((c) => c.query("select count(*)::int as n from clinics"));
    expect(service.rows[0].n).toBeGreaterThan(1);
  });

  it("addMember helper creates one membership per role", async () => {
    const clinicId = await createClinic();
    const { membershipId } = await addMember(clinicId, "dentist");
    expect(membershipId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("runAs picks RLS for a user actor and bypasses it for a service actor", async () => {
    const a = await seedClinic();
    await seedClinic();
    const user = await runAs(
      {
        kind: "user",
        userId: a.assistant.userId,
        clinicId: a.clinicId,
        membershipId: a.assistant.membershipId,
      },
      (c) => c.query("select id from clinics"),
    );
    expect(user.rowCount).toBe(1);
    const service = await runAs({ kind: "service", clinicId: a.clinicId }, (c) =>
      c.query("select id from clinics"),
    );
    expect(service.rowCount).toBeGreaterThan(1);
  });
});
