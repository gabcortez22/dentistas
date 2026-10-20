import { redirect } from "next/navigation";
import { type Actor, withService } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase/server";

export type Role = "admin" | "dentist" | "assistant";
export type SessionCtx = {
  userId: string;
  clinicId: string;
  membershipId: string;
  role: Role;
  displayName: string;
};
export type UserActor = Extract<Actor, { kind: "user" }>;

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function membershipForUser(userId: string): Promise<SessionCtx | null> {
  return withService(async (client) => {
    const { rows } = await client.query(
      `select user_id, clinic_id, id, role, display_name
         from memberships where user_id = $1 and active`,
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      clinicId: row.clinic_id,
      membershipId: row.id,
      role: row.role,
      displayName: row.display_name,
    };
  });
}

export async function getSession(): Promise<SessionCtx | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return membershipForUser(data.user.id);
}

export async function requireSession(): Promise<SessionCtx> {
  const ctx = await getSession();
  if (!ctx) redirect("/login");
  return ctx;
}

export function requireRole(ctx: { role: Role }, ...roles: Role[]): void {
  if (!roles.includes(ctx.role)) throw new ForbiddenError();
}

export function userActor(ctx: SessionCtx): UserActor {
  return {
    kind: "user",
    userId: ctx.userId,
    clinicId: ctx.clinicId,
    membershipId: ctx.membershipId,
  };
}
