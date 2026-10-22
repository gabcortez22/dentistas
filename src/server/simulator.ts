import { withTenant } from "@/lib/db";
import { ForbiddenError, type UserActor } from "@/server/session";

export type SimulatorMessage = { direction: string; body: string; createdAt: Date };

/** Gives the clinic a fake WhatsApp number if it has none, so the simulator can route messages to it. */
export async function ensureSimulatorNumber(actor: UserActor): Promise<string> {
  return withTenant(actor.userId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `update clinics set whatsapp_phone_number_id = coalesce(whatsapp_phone_number_id, $2)
        where id = $1 returning whatsapp_phone_number_id as id`,
      [actor.clinicId, `SIMULADOR-${actor.clinicId}`],
    );
    const id = rows[0]?.id;
    if (!id) throw new ForbiddenError();
    return id;
  });
}

export async function listSimulatorMessages(
  actor: UserActor,
  phoneDigits: string,
): Promise<SimulatorMessage[]> {
  return withTenant(actor.userId, async (client) => {
    const { rows } = await client.query(
      `select direction, body, created_at from whatsapp_messages
        where clinic_id = $1 and phone_e164 = $2 order by created_at, id limit 100`,
      [actor.clinicId, `+${phoneDigits}`],
    );
    return rows.map((r) => ({ direction: r.direction, body: r.body, createdAt: r.created_at }));
  });
}
