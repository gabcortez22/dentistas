import { withTenant } from "@/lib/db";
import type { UserActor } from "@/server/session";

export type DentistGoogleStatus = {
  displayName: string;
  googleEmail: string | null;
  status: string | null;
};

/** Dentists of the clinic with their Google link state; an admin sees all, anyone else only their own. */
export async function listGoogleConnections(
  actor: UserActor,
  role: string,
): Promise<DentistGoogleStatus[]> {
  return withTenant(actor.userId, async (client) => {
    const { rows } = await client.query(
      `select m.display_name, g.google_email, g.status
         from memberships m left join google_connections g on g.membership_id = m.id
        where m.clinic_id = $1 and m.role = 'dentist' and m.active
          and ($2 = 'admin' or m.id = $3)
        order by m.display_name`,
      [actor.clinicId, role, actor.membershipId],
    );
    return rows.map((r) => ({
      displayName: r.display_name,
      googleEmail: r.google_email,
      status: r.status,
    }));
  });
}
