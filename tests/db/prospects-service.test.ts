import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { type Actor, closePool as closeAppPool } from "@/lib/db";
import { createPatient, DuplicatePatientError } from "@/server/patients";
import {
  addNote,
  completeFollowup,
  convertToPatient,
  createProspect,
  getProspect,
  listDueFollowups,
  listProspects,
  moveStage,
  scheduleFollowup,
} from "@/server/prospects";
import { closePool, pool, seedClinic } from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

async function setup() {
  const a = await seedClinic();
  const actor: Actor = {
    kind: "user",
    userId: a.assistant.userId,
    clinicId: a.clinicId,
    membershipId: a.assistant.membershipId,
  };
  return { a, actor };
}

describe("prospects service", () => {
  it("returns the existing open prospect when the phone is already registered", async () => {
    const { actor } = await setup();
    const first = await createProspect(actor, {
      name: "Lucía",
      phone: "987 654 321",
      source: "whatsapp",
    });
    const second = await createProspect(actor, { name: "Lucía M.", phone: "+51987654321" });
    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, prospect: { id: first.prospect.id } });
    expect(first.prospect.phoneE164).toBe("+51987654321");
    expect(await listProspects(actor)).toHaveLength(1);
  });

  it("moveStage appends a stage_change event and demands a reason to close as lost", async () => {
    const { actor } = await setup();
    const { prospect } = await createProspect(actor, { name: "Pedro" });
    await moveStage(actor, prospect.id, "contacted");
    const error = await moveStage(actor, prospect.id, "lost").catch((e) => e);
    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).issues[0]?.path).toEqual(["lostReason"]);
    await moveStage(actor, prospect.id, "lost", { lostReason: "eligió otra clínica" });
    const detail = await getProspect(actor, prospect.id);
    expect(detail?.prospect).toMatchObject({ stage: "lost", lostReason: "eligió otra clínica" });
    const changes = detail?.events
      .filter((e) => e.kind === "stage_change")
      .map((e) => [e.body.from, e.body.to]);
    expect(changes).toEqual([
      ["new", "contacted"],
      ["contacted", "lost"],
    ]);
    await addNote(actor, prospect.id, "Llamó para preguntar por ortodoncia");
    expect((await getProspect(actor, prospect.id))?.events.at(-1)?.kind).toBe("note");
  });

  it("convertToPatient creates and links the patient, and refuses a duplicate document without linking", async () => {
    const { actor, a } = await setup();
    const { prospect } = await createProspect(actor, { name: "Rosa Díaz", phone: "987111222" });
    const patient = await convertToPatient(actor, prospect.id, {
      docNumber: "44445555",
      lastName: "Díaz",
      firstName: "Rosa",
    });
    expect(patient.phoneE164).toBe("+51987111222");
    const detail = await getProspect(actor, prospect.id);
    expect(detail?.prospect.patientId).toBe(patient.id);
    expect(detail?.events.map((e) => e.kind)).toContain("converted");
    await createPatient(actor, { docNumber: "66667777", lastName: "Existente", firstName: "Ya" });
    const other = await createProspect(actor, { name: "Otra", phone: "987333444" });
    await expect(
      convertToPatient(actor, other.prospect.id, {
        docNumber: "66667777",
        lastName: "Otra",
        firstName: "Persona",
      }),
    ).rejects.toBeInstanceOf(DuplicatePatientError);
    expect((await getProspect(actor, other.prospect.id))?.prospect.patientId).toBeNull();
    expect(
      (
        await pool.query("select count(*)::int as n from patients where clinic_id = $1", [
          a.clinicId,
        ])
      ).rows[0].n,
    ).toBe(2);
  });

  it("a follow-up is listed only while pending and due, and completing it records done_at", async () => {
    const { actor } = await setup();
    const { prospect } = await createProspect(actor, { name: "Mario" });
    const due = await scheduleFollowup(actor, prospect.id, {
      dueAt: new Date(Date.now() - 3_600_000),
      kind: "call",
      note: "Llamar",
    });
    await scheduleFollowup(actor, prospect.id, { dueAt: new Date(Date.now() + 86_400_000) });
    expect((await listDueFollowups(actor)).map((t) => t.id)).toEqual([due.id]);
    await completeFollowup(actor, due.id);
    expect(await listDueFollowups(actor)).toHaveLength(0);
    const row = await pool.query("select status, done_at from followup_tasks where id = $1", [
      due.id,
    ]);
    expect(row.rows[0].status).toBe("done");
    expect(row.rows[0].done_at).not.toBeNull();
    await expect(completeFollowup(actor, due.id)).rejects.toThrow(/not pending/);
  });

  it("convertToPatient does not leave a half-converted prospect: no conversion event after a duplicate document", async () => {
    const { actor } = await setup();
    await createPatient(actor, { docNumber: "12121212", lastName: "Existente", firstName: "Ya" });
    const { prospect } = await createProspect(actor, { name: "Otra", phone: "987222333" });
    await expect(
      convertToPatient(actor, prospect.id, {
        docNumber: "12121212",
        lastName: "O",
        firstName: "P",
      }),
    ).rejects.toBeInstanceOf(DuplicatePatientError);
    expect((await getProspect(actor, prospect.id))?.events.map((e) => e.kind)).not.toContain(
      "converted",
    );
  });

  it("convertToPatient is atomic: when linking fails after the patient insert, no patient remains", async () => {
    const { actor, a } = await setup();
    const { prospect } = await createProspect(actor, { name: "Atómico", phone: "987555666" });
    await pool.query(
      `create or replace function test_block_link() returns trigger language plpgsql as $$ begin
         if new.patient_id is not null and new.name = 'Atómico' then raise exception 'link blocked by test'; end if;
         return new; end $$`,
    );
    await pool.query(
      "create trigger test_block_link before update on prospects for each row execute function test_block_link()",
    );
    try {
      await expect(
        convertToPatient(actor, prospect.id, {
          docNumber: "88889999",
          lastName: "A",
          firstName: "B",
        }),
      ).rejects.toThrow(/link blocked/);
    } finally {
      await pool.query("drop trigger test_block_link on prospects");
      await pool.query("drop function test_block_link()");
    }
    expect(
      (
        await pool.query(
          "select count(*)::int as n from patients where clinic_id = $1 and doc_number = '88889999'",
          [a.clinicId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await getProspect(actor, prospect.id))?.prospect.patientId).toBeNull();
  });
});
