import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { closePool as closeAppPool } from "@/lib/db";
import {
  addEntry,
  addOdontogramMark,
  correctEntry,
  currentOdontogram,
  openRecord,
} from "@/server/clinical";
import { createPatient } from "@/server/patients";
import { ForbiddenError, type UserActor } from "@/server/session";
import { closePool, pool, seedClinic } from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

async function setup() {
  const a = await seedClinic();
  const actorOf = (m: { userId: string; membershipId: string }): UserActor => ({
    kind: "user",
    userId: m.userId,
    clinicId: a.clinicId,
    membershipId: m.membershipId,
  });
  const dentist = actorOf(a.dentist);
  const assistant = actorOf(a.assistant);
  const patient = await createPatient(assistant, {
    docNumber: String(Math.random()).slice(2, 10),
    lastName: "Quispe",
    firstName: "Luis",
  });
  return { a, dentist, assistant, patient };
}
const logCount = async (patientId: string) =>
  (
    await pool.query("select count(*)::int as n from record_access_log where patient_id = $1", [
      patientId,
    ])
  ).rows[0].n as number;

describe("clinical service", () => {
  it("addEntry stores a valid anamnesis authored by the actor and rejects an invalid body", async () => {
    const { dentist, patient, a } = await setup();
    const { id } = await addEntry(dentist, patient.id, "anamnesis", {
      motivoConsulta: "Dolor en una muela",
    });
    const { rows } = await pool.query(
      "select author_membership_id, kind from clinical_entries where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ author_membership_id: a.dentist.membershipId, kind: "anamnesis" });
    await expect(
      addEntry(dentist, patient.id, "anamnesis", { alergias: "ninguna" }),
    ).rejects.toBeInstanceOf(ZodError);
    const count = await pool.query(
      "select count(*)::int as n from clinical_entries where patient_id = $1",
      [patient.id],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("openRecord writes exactly one access-log row per call", async () => {
    const { dentist, patient } = await setup();
    await openRecord(dentist, patient.id);
    expect(await logCount(patient.id)).toBe(1);
    await openRecord(dentist, patient.id);
    expect(await logCount(patient.id)).toBe(2);
  });

  it("an assistant is forbidden and writes no log row", async () => {
    const { assistant, patient } = await setup();
    await expect(openRecord(assistant, patient.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      addEntry(assistant, patient.id, "evolucion", { texto: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await logCount(patient.id)).toBe(0);
  });

  it("correctEntry adds a correction note and leaves the original untouched", async () => {
    const { dentist, patient } = await setup();
    const { id } = await addEntry(dentist, patient.id, "evolucion", { texto: "Pieza 18 tratada" });
    const before = (await pool.query("select * from clinical_entries where id = $1", [id])).rows[0];
    const correction = await correctEntry(dentist, id, "Debe decir pieza 28");
    const row = (
      await pool.query("select kind, corrects_entry_id from clinical_entries where id = $1", [
        correction.id,
      ])
    ).rows[0];
    expect(row).toEqual({ kind: "nota_correccion", corrects_entry_id: id });
    expect(
      (await pool.query("select * from clinical_entries where id = $1", [id])).rows[0],
    ).toEqual(before);
    const record = await openRecord(dentist, patient.id);
    expect(record.entries.map((e) => e.kind)).toEqual(["evolucion", "nota_correccion"]);
  });

  it("currentOdontogram returns only the latest mark per tooth and surface", async () => {
    const { dentist, patient } = await setup();
    await addOdontogramMark(dentist, patient.id, { tooth: 18, surface: "O", condition: "caries" });
    await addOdontogramMark(dentist, patient.id, {
      tooth: 18,
      surface: "O",
      condition: "obturado",
    });
    await addOdontogramMark(dentist, patient.id, { tooth: 18, surface: "M", condition: "caries" });
    const marks = await currentOdontogram(dentist, patient.id);
    expect(marks.map((m) => [m.tooth, m.surface, m.condition])).toEqual([
      [18, "M", "caries"],
      [18, "O", "obturado"],
    ]);
    await expect(
      addOdontogramMark(dentist, patient.id, { tooth: 19, condition: "x" }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe("COP format fields", () => {
  it("accepts the Colegio Odontologico format: informante, vital signs, definitive diagnosis, prognosis and alta", async () => {
    const { dentist, patient } = await setup();
    await addEntry(dentist, patient.id, "anamnesis", {
      motivoConsulta: "Dolor",
      informante: "Paciente",
      tiempoEnfermedad: "3 días",
    });
    await addEntry(dentist, patient.id, "examen", {
      funcionesVitales: { presionArterial: "120/80", frecuenciaRespiratoria: "16" },
      examenClinicoGeneral: "Sin hallazgos",
    });
    await addEntry(dentist, patient.id, "diagnostico", {
      items: [{ descripcion: "Caries de dentina", cie10: "K02.1", tipo: "definitivo" }],
    });
    await addEntry(dentist, patient.id, "tratamiento", {
      items: [{ descripcion: "Resina", pieza: 26 }],
      plan: "2 sesiones",
      pronostico: "Favorable",
    });
    await addEntry(dentist, patient.id, "alta", { texto: "Alta con controles semestrales" });
    expect((await openRecord(dentist, patient.id)).entries.map((e) => e.kind)).toEqual([
      "anamnesis",
      "examen",
      "diagnostico",
      "tratamiento",
      "alta",
    ]);
  });
});
