import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { closePool as closeAppPool, withService } from "@/lib/db";
import {
  type AuthAdmin,
  addMember,
  LastAdminError,
  listMembers,
  registerClinic,
  setMemberActive,
} from "@/server/clinics";
import { ForbiddenError, membershipForUser, userActor } from "@/server/session";
import { closePool, pool, seedClinic } from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

function fakeAuth(existingId?: string) {
  const deleted: string[] = [];
  const created = vi.fn();
  const auth: AuthAdmin = {
    async createUser({ email }) {
      created(email);
      if (existingId) return { id: existingId };
      const { rows } = await pool.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [email],
      );
      return { id: rows[0]?.id as string };
    },
    async deleteUser(id) {
      deleted.push(id);
    },
  };
  return { auth, deleted, created };
}

const input = () => ({
  clinicName: "Clínica Sonrisa",
  adminName: "Dra. Ana",
  email: `${randomUUID()}@test.local`,
  password: "una-clave-larga-1",
});

describe("clinics and members", () => {
  it("registerClinic creates the clinic and its admin membership", async () => {
    const { auth } = fakeAuth();
    const result = await registerClinic(input(), auth);
    const { rows } = await pool.query(
      "select role, clinic_id, user_id from memberships where id = $1",
      [result.membershipId],
    );
    expect(rows[0]).toMatchObject({
      role: "admin",
      clinic_id: result.clinicId,
      user_id: result.userId,
    });
  });

  it("registerClinic deletes the auth user when the transaction fails", async () => {
    const seeded = await seedClinic();
    const { auth, deleted } = fakeAuth(seeded.admin.userId); // already has a membership: unique(user_id) fails
    await expect(registerClinic(input(), auth)).rejects.toThrow(/duplicate key/);
    expect(deleted).toEqual([seeded.admin.userId]);
  });

  it("registerClinic rejects a short password and creates nothing", async () => {
    const { auth, created } = fakeAuth();
    const error = await registerClinic({ ...input(), password: "corta" }, auth).catch((e) => e);
    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).issues[0]?.path).toEqual(["password"]);
    expect(created).not.toHaveBeenCalled();
  });

  it("only an admin can add members; a non-admin never reaches the auth provider", async () => {
    const a = await seedClinic();
    const { auth, created } = fakeAuth();
    const member = {
      displayName: "Nuevo",
      role: "assistant" as const,
      email: `${randomUUID()}@t.local`,
      password: "una-clave-larga-1",
    };
    const dentist = userActor({
      userId: a.dentist.userId,
      clinicId: a.clinicId,
      membershipId: a.dentist.membershipId,
      role: "dentist",
      displayName: "x",
    });
    await expect(addMember(dentist, "dentist", member, auth)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(created).not.toHaveBeenCalled();
    const admin = userActor({
      userId: a.admin.userId,
      clinicId: a.clinicId,
      membershipId: a.admin.membershipId,
      role: "admin",
      displayName: "x",
    });
    await addMember(admin, "admin", member, auth);
    expect(await listMembers(admin)).toHaveLength(4);
  });

  it("the only active admin cannot be deactivated", async () => {
    const a = await seedClinic();
    const admin = userActor({
      userId: a.admin.userId,
      clinicId: a.clinicId,
      membershipId: a.admin.membershipId,
      role: "admin",
      displayName: "x",
    });
    await expect(
      setMemberActive(admin, "admin", a.admin.membershipId, false),
    ).rejects.toBeInstanceOf(LastAdminError);
    const { rows } = await pool.query("select active from memberships where id = $1", [
      a.admin.membershipId,
    ]);
    expect(rows[0].active).toBe(true);
    await setMemberActive(admin, "admin", a.assistant.membershipId, false);
  });

  it("membershipForUser returns null for an inactive membership", async () => {
    const a = await seedClinic();
    expect((await membershipForUser(a.assistant.userId))?.role).toBe("assistant");
    await withService((c) =>
      c.query("update memberships set active = false where id = $1", [a.assistant.membershipId]),
    );
    expect(await membershipForUser(a.assistant.userId)).toBeNull();
  });
});
