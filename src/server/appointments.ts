import { type Actor, runAs } from "@/lib/db";
import { loadSlots } from "@/server/availability";

export class SlotTakenError extends Error {
  constructor() {
    super("that time slot is no longer available");
    this.name = "SlotTakenError";
  }
}
export class OutsideAvailabilityError extends Error {
  constructor() {
    super("that time is outside the dentist's availability");
    this.name = "OutsideAvailabilityError";
  }
}

export type Appointment = {
  id: string;
  clinicId: string;
  patientId: string;
  membershipId: string;
  startsAt: Date;
  endsAt: Date;
  status: "held" | "confirmed" | "completed" | "cancelled" | "no_show";
  source: "web" | "whatsapp" | "google";
  reason: string | null;
};

const toAppointment = (r: Record<string, unknown>): Appointment => ({
  id: r.id as string,
  clinicId: r.clinic_id as string,
  patientId: r.patient_id as string,
  membershipId: r.membership_id as string,
  startsAt: r.starts_at as Date,
  endsAt: r.ends_at as Date,
  status: r.status as Appointment["status"],
  source: r.source as Appointment["source"],
  reason: (r.reason as string) ?? null,
});

const isExclusionViolation = (error: unknown) => (error as { code?: string }).code === "23P01";

type BookInput = {
  patientId: string;
  membershipId: string;
  startsAt: Date;
  durationMinutes: number;
  reason?: string;
  source?: "web" | "whatsapp";
};

async function insertAppointment(
  actor: Actor,
  client: import("pg").PoolClient,
  input: BookInput,
  rescheduledFrom?: string,
): Promise<Appointment> {
  const own = await client.query(
    `select 1 from patients p, memberships m
      where p.id = $1 and p.clinic_id = $3 and m.id = $2 and m.clinic_id = $3 and m.active`,
    [input.patientId, input.membershipId, actor.clinicId],
  );
  if (!own.rowCount) throw new Error("patient or dentist not found in this clinic");
  const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);
  const { rows } = await client.query(
    `insert into appointments (clinic_id, patient_id, membership_id, starts_at, ends_at, status,
        source, reason, rescheduled_from_id, created_by)
     values ($1, $2, $3, $4, $5, 'confirmed', $6, $7, $8, $9) returning *`,
    [
      actor.clinicId,
      input.patientId,
      input.membershipId,
      input.startsAt,
      endsAt,
      input.source ?? "web",
      input.reason ?? null,
      rescheduledFrom ?? null,
      actor.kind === "user" ? actor.membershipId : null,
    ],
  );
  return toAppointment(rows[0]);
}

async function assertOffered(
  actor: Actor,
  membershipId: string,
  startsAt: Date,
  durationMinutes: number,
  now?: Date,
) {
  const slots = await loadSlots(
    actor,
    {
      membershipId,
      from: new Date(startsAt.getTime() - 1),
      to: new Date(startsAt.getTime() + durationMinutes * 60_000),
      durationMinutes,
    },
    { now, ignoreBookings: true },
  );
  if (!slots.some((s) => s.startsAt.getTime() === startsAt.getTime())) {
    throw new OutsideAvailabilityError();
  }
}

export async function bookAppointment(
  actor: Actor,
  input: BookInput,
  opts: { now?: Date } = {},
): Promise<Appointment> {
  await assertOffered(actor, input.membershipId, input.startsAt, input.durationMinutes, opts.now);
  try {
    return await runAs(actor, (client) => insertAppointment(actor, client, input));
  } catch (error) {
    if (isExclusionViolation(error)) throw new SlotTakenError();
    throw error;
  }
}

export async function cancelAppointment(actor: Actor, appointmentId: string): Promise<void> {
  await runAs(actor, (client) =>
    client.query("update appointments set status = 'cancelled' where id = $1 and clinic_id = $2", [
      appointmentId,
      actor.clinicId,
    ]),
  );
}

export async function rescheduleAppointment(
  actor: Actor,
  appointmentId: string,
  input: { startsAt: Date; durationMinutes: number },
  opts: { now?: Date } = {},
): Promise<Appointment> {
  const current = await runAs(actor, async (client) => {
    const { rows } = await client.query(
      "select * from appointments where id = $1 and clinic_id = $2 and status = 'confirmed'",
      [appointmentId, actor.clinicId],
    );
    return rows[0] ? toAppointment(rows[0]) : null;
  });
  if (!current) throw new Error("appointment not found or not confirmed");
  await assertOffered(actor, current.membershipId, input.startsAt, input.durationMinutes, opts.now);
  try {
    return await runAs(actor, async (client) => {
      await client.query(
        "update appointments set status = 'cancelled' where id = $1 and clinic_id = $2",
        [appointmentId, actor.clinicId],
      );
      return insertAppointment(
        actor,
        client,
        {
          patientId: current.patientId,
          membershipId: current.membershipId,
          startsAt: input.startsAt,
          durationMinutes: input.durationMinutes,
          reason: current.reason ?? undefined,
          source: current.source === "google" ? "web" : current.source,
        },
        appointmentId,
      );
    });
  } catch (error) {
    if (isExclusionViolation(error)) throw new SlotTakenError();
    throw error;
  }
}

export async function listAppointments(
  actor: Actor,
  q: { from: Date; to: Date; membershipId?: string },
): Promise<Array<Appointment & { patientName: string; dentistName: string }>> {
  return runAs(actor, async (client) => {
    const { rows } = await client.query(
      `select a.*, p.last_name || ', ' || p.first_name as patient_name, m.display_name as dentist_name
         from appointments a
         join patients p on p.id = a.patient_id
         join memberships m on m.id = a.membership_id
        where a.clinic_id = $1 and a.starts_at >= $2 and a.starts_at < $3
          and ($4::uuid is null or a.membership_id = $4)
        order by a.starts_at`,
      [actor.clinicId, q.from, q.to, q.membershipId ?? null],
    );
    return rows.map((r) => ({
      ...toAppointment(r),
      patientName: r.patient_name as string,
      dentistName: r.dentist_name as string,
    }));
  });
}
