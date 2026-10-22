import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { withService, withTenant } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { ForbiddenError, type Role, type UserActor } from "@/server/session";

export type AuthAdmin = {
  createUser(input: { email: string; password: string }): Promise<{ id: string }>;
  deleteUser(id: string): Promise<void>;
};

export class LastAdminError extends Error {
  constructor() {
    super("last active admin cannot be deactivated");
    this.name = "LastAdminError";
  }
}

function adminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL: url } = getEnv("supabase");
  const { SUPABASE_SECRET_KEY: key } = getEnv("supabaseAdmin");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export const supabaseAuthAdmin: AuthAdmin = {
  async createUser({ email, password }) {
    const { data, error } = await adminClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(error?.message ?? "could not create the user");
    return { id: data.user.id };
  },
  async deleteUser(id) {
    const { error } = await adminClient().auth.admin.deleteUser(id);
    if (error) throw new Error(error.message);
  },
};

const credentials = {
  email: z.email(),
  password: z.string().min(10),
};
const registerSchema = z.object({
  clinicName: z.string().trim().min(1),
  adminName: z.string().trim().min(1),
  ...credentials,
});
const memberSchema = z.object({
  displayName: z.string().trim().min(1),
  role: z.enum(["admin", "dentist", "assistant"]),
  ...credentials,
});

export async function registerClinic(
  input: { clinicName: string; adminName: string; email: string; password: string },
  auth: AuthAdmin = supabaseAuthAdmin,
): Promise<{ clinicId: string; userId: string; membershipId: string }> {
  const data = registerSchema.parse(input);
  const user = await auth.createUser({ email: data.email, password: data.password });
  try {
    return await withService(async (client) => {
      const clinic = await client.query<{ id: string }>(
        "insert into clinics (name) values ($1) returning id",
        [data.clinicName],
      );
      const clinicId = clinic.rows[0]?.id as string;
      const member = await client.query<{ id: string }>(
        `insert into memberships (clinic_id, user_id, role, display_name)
         values ($1, $2, 'admin', $3) returning id`,
        [clinicId, user.id, data.adminName],
      );
      return { clinicId, userId: user.id, membershipId: member.rows[0]?.id as string };
    });
  } catch (error) {
    await auth.deleteUser(user.id).catch(() => undefined);
    throw error;
  }
}

export async function addMember(
  actor: UserActor,
  role: Role,
  input: { displayName: string; email: string; password: string; role: Role },
  auth: AuthAdmin = supabaseAuthAdmin,
): Promise<{ membershipId: string; userId: string }> {
  if (role !== "admin") throw new ForbiddenError();
  const data = memberSchema.parse(input);
  const user = await auth.createUser({ email: data.email, password: data.password });
  try {
    const membershipId = await withTenant(actor.userId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into memberships (clinic_id, user_id, role, display_name)
         values ($1, $2, $3, $4) returning id`,
        [actor.clinicId, user.id, data.role, data.displayName],
      );
      return rows[0]?.id as string;
    });
    return { membershipId, userId: user.id };
  } catch (error) {
    await auth.deleteUser(user.id).catch(() => undefined);
    throw error;
  }
}

export async function getClinicName(actor: UserActor): Promise<string> {
  return withTenant(actor.userId, async (client) => {
    const { rows } = await client.query<{ name: string }>(
      "select name from clinics where id = $1",
      [actor.clinicId],
    );
    return rows[0]?.name ?? "";
  });
}

export async function listMembers(
  actor: UserActor,
): Promise<Array<{ id: string; displayName: string; role: Role; active: boolean }>> {
  return withTenant(actor.userId, async (client) => {
    const { rows } = await client.query(
      `select id, display_name, role, active from memberships
        where clinic_id = $1 order by created_at`,
      [actor.clinicId],
    );
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      role: r.role,
      active: r.active,
    }));
  });
}

export async function setMemberActive(
  actor: UserActor,
  role: Role,
  membershipId: string,
  active: boolean,
): Promise<void> {
  if (role !== "admin") throw new ForbiddenError();
  await withTenant(actor.userId, async (client) => {
    const target = await client.query<{ role: Role; active: boolean }>(
      "select role, active from memberships where id = $1 and clinic_id = $2",
      [membershipId, actor.clinicId],
    );
    const row = target.rows[0];
    if (!row) throw new Error("membership not found");
    if (!active && row.role === "admin" && row.active) {
      const admins = await client.query(
        "select id from memberships where clinic_id = $1 and role = 'admin' and active for update",
        [actor.clinicId],
      );
      if (admins.rowCount !== null && admins.rowCount <= 1) throw new LastAdminError();
    }
    await client.query("update memberships set active = $3 where id = $1 and clinic_id = $2", [
      membershipId,
      actor.clinicId,
      active,
    ]);
  });
}
