import { afterAll, describe, expect, it } from "vitest";
import { closePool as closeAppPool } from "@/lib/db";
import { addEntry } from "@/server/clinical";
import { recordDataConsent } from "@/server/patient-consent";
import { exportPatientData } from "@/server/patient-export";
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
  return { dentist, assistant, patient };
}
const logCount = async (patientId: string) =>
  (
    await pool.query("select count(*)::int as n from record_access_log where patient_id = $1", [
      patientId,
    ])
  ).rows[0].n as number;

describe("patient data export", () => {
  it("returns the ficha, consent and clinical entries, and logs the access", async () => {
    const { dentist, patient } = await setup();
    await addEntry(dentist, patient.id, "evolucion", { texto: "Pieza 18 tratada" });
    await recordDataConsent(dentist, patient.id);
    const data = await exportPatientData(dentist, patient.id);
    expect(data.patient.lastName).toBe("Quispe");
    expect(data.dataConsent?.version).toBeTruthy();
    expect(data.clinicalEntries).toHaveLength(1);
    expect(await logCount(patient.id)).toBe(1);
  });

  it("refuses an assistant and logs nothing", async () => {
    const { assistant, patient } = await setup();
    await expect(exportPatientData(assistant, patient.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await logCount(patient.id)).toBe(0);
  });

  it("does not export a patient of another clinic", async () => {
    const one = await setup();
    const other = await setup();
    await expect(exportPatientData(other.dentist, one.patient.id)).rejects.toThrow(
      "patient not found",
    );
  });
});
