import { afterAll, describe, expect, it } from "vitest";
import { type Actor, closePool as closeAppPool } from "@/lib/db";
import {
  bookAppointment,
  cancelAppointment,
  OutsideAvailabilityError,
  rescheduleAppointment,
  SlotTakenError,
} from "@/server/appointments";
import { loadSlots } from "@/server/availability";
import { createPatient } from "@/server/patients";
import { closePool, pool, seedClinic } from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

// Sunday 2027-02-28 07:00 in Lima. The next Monday is 2027-03-01: 09:00-12:00 Lima = 14:00Z-17:00Z.
const NOW = new Date("2027-02-28T12:00:00Z");
const DAY = { from: new Date("2027-03-01T05:00:00Z"), to: new Date("2027-03-02T05:00:00Z") };

async function setup() {
  const a = await seedClinic();
  await pool.query(
    `insert into availability_rules (clinic_id, membership_id, weekday, start_time, end_time)
     values ($1, $2, 1, '09:00', '12:00')`,
    [a.clinicId, a.dentist.membershipId],
  );
  const actor: Actor = {
    kind: "user",
    userId: a.assistant.userId,
    clinicId: a.clinicId,
    membershipId: a.assistant.membershipId,
  };
  const patient = await createPatient(actor, {
    docNumber: String(Math.random()).slice(2, 10),
    lastName: "Rojas",
    firstName: "Eva",
  });
  const slots = () =>
    loadSlots(
      actor,
      { membershipId: a.dentist.membershipId, ...DAY, durationMinutes: 30 },
      { now: NOW },
    );
  const book = (startsAt: Date) =>
    bookAppointment(
      actor,
      {
        patientId: patient.id,
        membershipId: a.dentist.membershipId,
        startsAt,
        durationMinutes: 30,
      },
      { now: NOW },
    );
  return { a, actor, patient, slots, book };
}

describe("appointments service", () => {
  it("loadSlots returns six 30-minute slots for the next Monday in Lima", async () => {
    const { slots } = await setup();
    const result = await slots();
    expect(result).toHaveLength(6);
    expect(result[0]?.startsAt.toISOString()).toBe("2027-03-01T14:00:00.000Z");
  });

  it("booking an offered slot confirms it and removes it from the offers", async () => {
    const { slots, book } = await setup();
    const first = (await slots())[0];
    const appointment = await book(first?.startsAt as Date);
    expect(appointment.status).toBe("confirmed");
    expect(await slots()).toHaveLength(5);
  });

  it("a time outside working hours is refused and nothing is inserted", async () => {
    const { a, book } = await setup();
    await expect(book(new Date("2027-03-01T20:00:00Z"))).rejects.toBeInstanceOf(
      OutsideAvailabilityError,
    );
    const { rows } = await pool.query(
      "select count(*)::int as n from appointments where clinic_id = $1",
      [a.clinicId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("20 concurrent bookings of one slot: one succeeds, 19 get SlotTakenError", async () => {
    const { slots, book } = await setup();
    const start = (await slots())[1]?.startsAt as Date;
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => book(start)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failures.every((f) => f.reason instanceof SlotTakenError)).toBe(true);
  });

  it("reschedule moves the appointment atomically and keeps the old one when the new slot is taken", async () => {
    const { a, actor, slots, book } = await setup();
    const all = await slots();
    const original = await book(all[0]?.startsAt as Date);
    await book(all[2]?.startsAt as Date);
    await expect(
      rescheduleAppointment(
        actor,
        original.id,
        { startsAt: all[2]?.startsAt as Date, durationMinutes: 30 },
        { now: NOW },
      ),
    ).rejects.toBeInstanceOf(SlotTakenError);
    const still = await pool.query("select status from appointments where id = $1", [original.id]);
    expect(still.rows[0].status).toBe("confirmed");
    const moved = await rescheduleAppointment(
      actor,
      original.id,
      { startsAt: all[4]?.startsAt as Date, durationMinutes: 30 },
      { now: NOW },
    );
    expect(moved.status).toBe("confirmed");
    const rows = await pool.query(
      "select status, rescheduled_from_id from appointments where clinic_id = $1 and id in ($2, $3) order by created_at",
      [a.clinicId, original.id, moved.id],
    );
    expect(rows.rows).toEqual([
      { status: "cancelled", rescheduled_from_id: null },
      { status: "confirmed", rescheduled_from_id: original.id },
    ]);
  });

  it("cancelling frees the slot again", async () => {
    const { actor, slots, book } = await setup();
    const first = (await slots())[0]?.startsAt as Date;
    const appointment = await book(first);
    expect(await slots()).toHaveLength(5);
    await cancelAppointment(actor, appointment.id);
    expect(await slots()).toHaveLength(6);
  });
});
