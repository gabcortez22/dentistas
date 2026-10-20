import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { type Actor, closePool as closeAppPool } from "@/lib/db";
import { normalizePhonePE } from "@/lib/phone";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy";
import { getDataConsent, recordDataConsent } from "@/server/patient-consent";
import {
  archivePatient,
  createPatient,
  DuplicatePatientError,
  getPatient,
  searchPatients,
  updatePatient,
} from "@/server/patients";
import { closePool, pool, seedClinic } from "./helpers";

afterAll(async () => {
  await closePool();
  await closeAppPool();
});

async function actorOf(role: "assistant" | "admin" = "assistant") {
  const a = await seedClinic();
  const m = role === "admin" ? a.admin : a.assistant;
  const actor: Actor = {
    kind: "user",
    userId: m.userId,
    clinicId: a.clinicId,
    membershipId: m.membershipId,
  };
  return { a, actor };
}
const base = (over: Record<string, unknown> = {}) => ({
  docType: "DNI",
  docNumber: String(Math.random()).slice(2, 10),
  lastName: "Pérez",
  firstName: "Ana",
  ...over,
});

describe("patients", () => {
  it.each(["987 654 321", "+51 987-654-321", "51987654321"])(
    "stores %s as +51987654321 and uses the DNI as clinical record number",
    async (phone) => {
      const { actor } = await actorOf();
      const p = await createPatient(actor, base({ docNumber: "12345678", phone }));
      expect(p.phoneE164).toBe("+51987654321");
      expect(p.hcNumber).toBe("12345678");
    },
  );

  it("rejects an invalid phone, naming the field", async () => {
    const { actor } = await actorOf();
    const error = await createPatient(actor, base({ phone: "12345" })).catch((e) => e);
    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).issues[0]?.path).toEqual(["phone"]);
  });

  it("rejects a DNI that is not 8 digits and inserts nothing", async () => {
    const { actor, a } = await actorOf();
    const error = await createPatient(actor, base({ docNumber: "1234" })).catch((e) => e);
    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).issues[0]?.path).toEqual(["docNumber"]);
    const { rows } = await pool.query(
      "select count(*)::int as n from patients where clinic_id = $1",
      [a.clinicId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("refuses a duplicate document in one clinic but allows it in another", async () => {
    const one = await actorOf();
    const two = await actorOf();
    await createPatient(one.actor, base({ docNumber: "11112222" }));
    await expect(createPatient(one.actor, base({ docNumber: "11112222" }))).rejects.toBeInstanceOf(
      DuplicatePatientError,
    );
    await createPatient(two.actor, base({ docNumber: "11112222" }));
  });

  it("whatsapp opt-in needs a phone and records the moment", async () => {
    const { actor } = await actorOf();
    await expect(createPatient(actor, base({ whatsappOptIn: true }))).rejects.toBeInstanceOf(
      ZodError,
    );
    const p = await createPatient(actor, base({ whatsappOptIn: true, phone: "987654321" }));
    const { rows } = await pool.query("select whatsapp_opt_in_at from patients where id = $1", [
      p.id,
    ]);
    expect(rows[0].whatsapp_opt_in_at).not.toBeNull();
  });

  it("stores religion, race and place of origin from the COP format", async () => {
    const { actor } = await actorOf();
    const p = await createPatient(
      actor,
      base({ religion: "Católica", race: "Mestiza", originPlace: "Cusco" }),
    );
    expect([p.religion, p.race, p.originPlace]).toEqual(["Católica", "Mestiza", "Cusco"]);
  });

  it("edits a patient, clears an emptied optional field and keeps the document", async () => {
    const { actor } = await actorOf();
    const p = await createPatient(actor, base({ phone: "987654321", occupation: "Docente" }));
    const edited = await updatePatient(actor, p.id, {
      lastName: "Quispe",
      occupation: "",
      phone: "",
      whatsappOptIn: false,
    });
    expect(edited.lastName).toBe("Quispe");
    expect(edited.occupation).toBeNull();
    expect(edited.phoneE164).toBeNull();
    expect(edited.docNumber).toBe(p.docNumber);
    await expect(updatePatient(actor, p.id, { firstName: "" })).rejects.toBeInstanceOf(ZodError);
  });

  it("records data consent once with the policy version and keeps the first date", async () => {
    const { actor } = await actorOf();
    const p = await createPatient(actor, base());
    expect(await getDataConsent(actor, p.id)).toBeNull();
    await recordDataConsent(actor, p.id);
    const first = await getDataConsent(actor, p.id);
    expect(first?.version).toBe(PRIVACY_POLICY_VERSION);
    await recordDataConsent(actor, p.id);
    expect((await getDataConsent(actor, p.id))?.at).toEqual(first?.at);
  });

  it("does not record or read consent for a patient of another clinic", async () => {
    const one = await actorOf();
    const other = await actorOf();
    const p = await createPatient(one.actor, base());
    await recordDataConsent(other.actor, p.id);
    expect(await getDataConsent(one.actor, p.id)).toBeNull();
    expect(await getDataConsent(other.actor, p.id)).toBeNull();
  });

  it("search is case-insensitive over names and document, limited to the clinic", async () => {
    const one = await actorOf();
    const two = await actorOf();
    await createPatient(one.actor, base({ lastName: "Pereyra", docNumber: "30000001" }));
    await createPatient(two.actor, base({ lastName: "Pereira", docNumber: "30000002" }));
    expect((await searchPatients(one.actor, { q: "PERE" })).map((p) => p.lastName)).toEqual([
      "Pereyra",
    ]);
    expect((await searchPatients(one.actor, { q: "30000001" })).length).toBe(1);
    expect((await searchPatients(one.actor, { q: "50%" })).length).toBe(0);
  });

  it("archiving hides the patient from the default search and keeps the row", async () => {
    const { actor } = await actorOf("admin");
    const p = await createPatient(actor, base());
    await archivePatient(actor, p.id);
    expect(await searchPatients(actor)).toHaveLength(0);
    expect(await searchPatients(actor, { includeArchived: true })).toHaveLength(1);
    expect((await getPatient(actor, p.id))?.archivedAt).not.toBeNull();
  });

  it.each([
    ["987654321", "+51987654321"],
    ["+51 987-654-321", "+51987654321"],
    ["51987654321", "+51987654321"],
    ["12345", null],
  ])("normalizePhonePE(%s)", (raw, expected) => {
    expect(normalizePhonePE(raw)).toBe(expected);
  });
});
